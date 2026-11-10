import { describe, test, expect, mock, beforeAll } from 'bun:test';
import type { InvoiceScanStatus } from './cost.types';

const ocrCalls: unknown[] = [];

mock.module('./http', () => ({
  postJson: async (url: string, body: unknown) => {
    ocrCalls.push(body);
    return {
      document_annotation: JSON.stringify({
        vendor: 'hetzner',
        invoice_date: '2026-11-10',
        period_start: '2026-10-01',
        period_end: '2026-10-31',
        currency: 'EUR',
        amount_gross: 41.65,
      }),
      usage_info: { pages_processed: 1 },
    };
  },
  getJson: async () => ({}),
}));

mock.module('./providers/fx', () => ({
  fetchChfRateOn: async () => 0.94,
  fetchChfRates: async () => ({ rates: {}, date: '2026-11-10', stale: false }),
  fallbackRates: () => ({ rates: {}, date: '2026-11-10', stale: true }),
  toChf: () => null,
}));

let InvoiceIngestService: typeof import('./invoice-ingest.service').InvoiceIngestService;

beforeAll(async () => {
  process.env.COST_INVOICE_DOC_ID = 'rechnungen-fQnLX94fpZ';
  process.env.MISTRAL_API_KEY = 'test-key';
  ({ InvoiceIngestService } = await import('./invoice-ingest.service'));
});

function attachment(id: string, fileName: string) {
  return { id, documentId: 'doc-1', key: `uploads/u/${id}/${fileName}`, fileName, size: 50_000 };
}

function setup(options: {
  attachments: ReturnType<typeof attachment>[];
  existing?: { attachment_id: string; file_name: string }[];
  missingKeys?: string[];
}) {
  const inserted: Record<string, unknown>[] = [];
  const statuses: InvoiceScanStatus[] = [];
  const downloads: string[] = [];
  ocrCalls.length = 0;

  const repository = {
    find: async () => options.existing ?? [],
    insert: async (row: Record<string, unknown>) => {
      if (!row.id) throw new Error('null value in column "id"');
      inserted.push(row);
    },
    query: async () => [],
  };
  const outlineSync = {
    listDocumentTree: async () => ['doc-1'],
    listPdfAttachments: async () => options.attachments,
  };
  const scanStatus = {
    set: async (status: InvoiceScanStatus) => {
      statuses.push({ ...status });
    },
  };

  const costService = { invalidate: async () => undefined };
  const service = new InvoiceIngestService(
    repository as never,
    outlineSync as never,
    scanStatus as never,
    costService as never,
  );
  (service as unknown as { downloadAttachment: (key: string) => Promise<Uint8Array> }).downloadAttachment =
    async (key: string) => {
      downloads.push(key);
      if (options.missingKeys?.includes(key)) {
        throw Object.assign(new Error('Key not found'), { name: 'NoSuchKey' });
      }
      return new Uint8Array([37, 80, 68, 70]);
    };

  return { service, inserted, statuses, downloads };
}

describe('InvoiceIngestService.scan', () => {
  test('stores a parsed invoice with an id', async () => {
    const { service, inserted } = setup({ attachments: [attachment('a1', 'Hetzner_2026-11-10_1.pdf')] });

    const result = await service.scan();

    expect(result).toEqual({ scanned: 1, ingested: 1, failed: 0, skipped: 0 });
    expect(inserted).toHaveLength(1);
    expect(typeof inserted[0].id).toBe('string');
    expect(inserted[0]).toMatchObject({ vendor: 'hetzner', amount_gross: '41.65', parse_status: 'parsed' });
  });

  test('skips an attachment whose file is gone from the bucket, without recording a failure', async () => {
    const missing = attachment('a1', 'Hetzner_2026-10-10_1.pdf');
    const { service, inserted } = setup({ attachments: [missing], missingKeys: [missing.key] });

    const result = await service.scan();

    expect(result).toEqual({ scanned: 1, ingested: 0, failed: 0, skipped: 1 });
    expect(inserted).toHaveLength(0);
  });

  test('reads the same PDF only once, falling through a deleted copy to a live one', async () => {
    const deleted = attachment('a1', 'Hetzner_2026-10-10_1.pdf');
    const live = attachment('a2', 'Hetzner_2026-10-10_1.pdf');
    const again = attachment('a3', 'Hetzner_2026-10-10_1.pdf');
    const { service, inserted } = setup({ attachments: [deleted, live, again], missingKeys: [deleted.key] });

    const result = await service.scan();

    expect(result).toEqual({ scanned: 3, ingested: 1, failed: 0, skipped: 2 });
    expect(inserted.map((row) => row.attachment_id)).toEqual(['a2']);
    expect(ocrCalls).toHaveLength(1);
  });

  test('does not download or OCR an invoice already on file under another attachment', async () => {
    const { service, downloads } = setup({
      attachments: [attachment('a9', 'Hetzner_2026-09-05_1.pdf')],
      existing: [{ attachment_id: 'a1', file_name: 'Hetzner_2026-09-05_1.pdf' }],
    });

    const result = await service.scan();

    expect(result).toEqual({ scanned: 1, ingested: 0, failed: 0, skipped: 1 });
    expect(downloads).toHaveLength(0);
    expect(ocrCalls).toHaveLength(0);
  });

  test('reports progress and ends in done', async () => {
    const { service, statuses } = setup({
      attachments: [attachment('a1', 'Hetzner_2026-10-10_1.pdf'), attachment('a2', 'Hetzner_2026-11-10_1.pdf')],
    });

    await service.scan();

    const last = statuses[statuses.length - 1];
    expect(statuses[0].state).toBe('running');
    expect(statuses.some((s) => s.current === 'Hetzner_2026-11-10_1.pdf')).toBe(true);
    expect(last).toMatchObject({ state: 'done', total: 2, done: 2, ingested: 2, current: null });
    expect(last.finishedAt).not.toBeNull();
  });
});
