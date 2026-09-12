import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { pagePriceUsd } from '@cleancentive/shared';
import { v7 as uuidv7 } from 'uuid';
import { getOutlineS3ClientConfig } from '../common/outline-s3-client';
import { OutlineSyncService } from '../outline-sync/outline-sync.service';
import { postJson } from './http';
import { fetchChfRateOn } from './providers/fx';
import { VendorInvoice } from './vendor-invoice.entity';
import { VENDORS } from './cost.types';

const MISTRAL_API = 'https://api.mistral.ai/v1';
const OCR_MODEL = 'mistral-ocr-latest';
/** B2 charges for downloads and OCR charges per page; a 20 MB "invoice" is not one. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** What we ask the model to pull out of each bill. */
const INVOICE_SCHEMA = {
  type: 'object',
  title: 'Invoice',
  properties: {
    vendor: {
      type: 'string',
      description:
        'Which company issued this invoice, lowercase, one of: hetzner, mistral, backblaze, resend, other',
    },
    invoice_date: { type: 'string', description: 'Invoice date as YYYY-MM-DD' },
    period_start: { type: 'string', description: 'Start of the billed period as YYYY-MM-DD, or empty' },
    period_end: { type: 'string', description: 'End of the billed period as YYYY-MM-DD, or empty' },
    currency: { type: 'string', description: 'ISO 4217 currency code, e.g. EUR, USD, CHF' },
    amount_gross: {
      type: 'number',
      description: 'The total amount payable including VAT or tax, as a number',
    },
  },
  required: ['vendor', 'invoice_date', 'currency', 'amount_gross'],
  additionalProperties: false,
};

export interface ParsedInvoice {
  vendor: string;
  invoiceDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string | null;
  amountGross: number | null;
}

interface OcrResponse {
  document_annotation?: string | Record<string, unknown>;
  usage_info?: { pages_processed?: number };
}

function asDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * Normalises whatever the model returned into a row, or rejects it.
 *
 * Kept pure and separate from the fetching so the mapping — the part most likely
 * to be wrong about a real invoice — is testable without a network or a PDF.
 */
export function normalizeAnnotation(raw: unknown): ParsedInvoice | null {
  const parsed = typeof raw === 'string' ? safeParse(raw) : (raw as Record<string, unknown> | null);
  if (!parsed || typeof parsed !== 'object') return null;

  const amount = Number(parsed.amount_gross);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const currency = typeof parsed.currency === 'string' ? parsed.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return null;

  const claimed = typeof parsed.vendor === 'string' ? parsed.vendor.trim().toLowerCase() : '';
  const vendor = (VENDORS as readonly string[]).includes(claimed) ? claimed : 'other';

  return {
    vendor,
    invoiceDate: asDate(parsed.invoice_date),
    periodStart: asDate(parsed.period_start),
    periodEnd: asDate(parsed.period_end),
    currency,
    amountGross: amount,
  };
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable()
export class InvoiceIngestService {
  private readonly logger = new Logger(InvoiceIngestService.name);
  private readonly documentId = process.env.COST_INVOICE_DOC_ID ?? '';
  private readonly mistralApiKey = process.env.MISTRAL_API_KEY ?? '';
  private readonly wikiBucket = process.env.OUTLINE_S3_BUCKET ?? 'cleancentive-wiki';

  constructor(
    @InjectRepository(VendorInvoice)
    private readonly invoiceRepository: Repository<VendorInvoice>,
    private readonly outlineSync: OutlineSyncService,
  ) {}

  /**
   * Reads any invoice PDF in the wiki that we have not read before.
   *
   * Already-ingested attachments are skipped before anything is downloaded or
   * OCR'd, so re-scanning — on a webhook, a cron, or a button — costs nothing.
   */
  async scan(): Promise<{ scanned: number; ingested: number; failed: number; skipped: number }> {
    if (!this.documentId) {
      this.logger.log('Invoice scan skipped: COST_INVOICE_DOC_ID is not set');
      return { scanned: 0, ingested: 0, failed: 0, skipped: 0 };
    }

    const documentIds = await this.outlineSync.listDocumentTree(this.documentId);
    const attachments = await this.outlineSync.listPdfAttachments(documentIds);
    if (attachments.length === 0) {
      return { scanned: 0, ingested: 0, failed: 0, skipped: 0 };
    }

    const known = new Set(
      (
        await this.invoiceRepository.find({
          select: ['attachment_id'],
          where: { attachment_id: In(attachments.map((a) => a.id)) },
        })
      ).map((row) => row.attachment_id),
    );

    let ingested = 0;
    let failed = 0;
    let skipped = 0;

    for (const attachment of attachments) {
      if (known.has(attachment.id)) {
        skipped++;
        continue;
      }
      if (attachment.size > MAX_PDF_BYTES) {
        this.logger.warn(`Skipping ${attachment.fileName}: ${attachment.size} bytes is too large for an invoice`);
        skipped++;
        continue;
      }

      try {
        await this.ingestOne(attachment);
        ingested++;
      } catch (error) {
        this.logger.warn(
          `Could not read invoice ${attachment.fileName}: ${error instanceof Error ? error.message : error}`,
        );
        await this.saveFailure(attachment, error);
        failed++;
      }
    }

    if (ingested || failed) {
      this.logger.log(`Invoice scan: ${ingested} ingested, ${failed} unreadable, ${skipped} already known`);
    }
    return { scanned: attachments.length, ingested, failed, skipped };
  }

  private async ingestOne(attachment: {
    id: string;
    documentId: string;
    key: string;
    fileName: string;
  }): Promise<void> {
    if (!this.mistralApiKey) {
      throw new Error('MISTRAL_API_KEY is not set, so invoice PDFs cannot be read');
    }

    const bytes = await this.downloadAttachment(attachment.key);
    const ocr = await postJson<OcrResponse>(
      `${MISTRAL_API}/ocr`,
      {
        model: OCR_MODEL,
        document: {
          type: 'document_url',
          document_url: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`,
        },
        document_annotation_format: {
          type: 'json_schema',
          json_schema: { name: 'invoice', schema: INVOICE_SCHEMA, strict: true },
        },
      },
      { Authorization: `Bearer ${this.mistralApiKey}` },
      60_000,
    );

    await this.recordOcrCost(ocr.usage_info?.pages_processed ?? 1);

    const parsed = normalizeAnnotation(ocr.document_annotation);
    if (!parsed) {
      throw new Error('OCR returned no usable invoice total');
    }

    const { amountChf, fxRate } = await this.convert(parsed);

    await this.invoiceRepository.insert({
      attachment_id: attachment.id,
      outline_document_id: attachment.documentId,
      file_name: attachment.fileName,
      vendor: parsed.vendor,
      invoice_date: parsed.invoiceDate,
      period_start: parsed.periodStart,
      period_end: parsed.periodEnd,
      currency: parsed.currency,
      amount_gross: parsed.amountGross?.toFixed(2) ?? null,
      amount_chf: amountChf?.toFixed(2) ?? null,
      fx_rate: fxRate?.toFixed(6) ?? null,
      parse_status: 'parsed',
      parsed_raw: (typeof ocr.document_annotation === 'string'
        ? safeParse(ocr.document_annotation)
        : (ocr.document_annotation as Record<string, unknown>)) ?? null,
    });
  }

  private async convert(parsed: ParsedInvoice): Promise<{ amountChf: number | null; fxRate: number | null }> {
    if (parsed.amountGross === null || !parsed.currency) return { amountChf: null, fxRate: null };

    try {
      // The rate on the invoice date, frozen on the row — a past month must not
      // change value every time someone opens the page.
      const rate = await fetchChfRateOn(parsed.currency, parsed.invoiceDate ?? new Date().toISOString().slice(0, 10));
      return { amountChf: parsed.amountGross * rate, fxRate: rate };
    } catch (error) {
      this.logger.warn(`No FX rate for ${parsed.currency}: ${error instanceof Error ? error.message : error}`);
      return { amountChf: null, fxRate: null };
    }
  }

  private async saveFailure(
    attachment: { id: string; documentId: string; fileName: string },
    error: unknown,
  ): Promise<void> {
    // Recorded rather than retried: a PDF we cannot read will not become
    // readable on the next pass, and a row on the page is something a steward
    // can correct by hand.
    await this.invoiceRepository
      .insert({
        attachment_id: attachment.id,
        outline_document_id: attachment.documentId,
        file_name: attachment.fileName,
        vendor: 'other',
        parse_status: 'failed',
        parsed_raw: { error: error instanceof Error ? error.message : String(error) },
      })
      .catch(() => undefined);
  }

  private async downloadAttachment(key: string): Promise<Uint8Array> {
    const client = new S3Client(getOutlineS3ClientConfig(process.env));
    const response = await client.send(new GetObjectCommand({ Bucket: this.wikiBucket, Key: key }));
    if (!response.Body) throw new Error(`Attachment ${key} has no body`);
    return await response.Body.transformToByteArray();
  }

  /** The OCR call is itself Mistral spend, so it belongs on the same dashboard. */
  private async recordOcrCost(pages: number): Promise<void> {
    try {
      await this.invoiceRepository.query(
        `INSERT INTO llm_usage (id, purpose, provider_label, provider_host, model, pages, cost_usd)
         VALUES ($1, 'invoice-ocr', 'primary', 'api.mistral.ai', $2, $3, $4)`,
        [uuidv7(), OCR_MODEL, pages, pagePriceUsd(OCR_MODEL, pages)],
      );
    } catch (error) {
      this.logger.warn(`Could not record OCR cost: ${error instanceof Error ? error.message : error}`);
    }
  }
}
