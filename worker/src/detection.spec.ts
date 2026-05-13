import { describe, test, expect } from 'bun:test';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { persistDetection, batchResolveLabels, insertDetectedItems } from './detection';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

interface MockResponse {
  match: (text: string) => boolean;
  rows: QueryResultRow[];
}

function createMockClient(responses: MockResponse[]): {
  client: PoolClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
    async query(text: string, values?: unknown[]): Promise<QueryResult> {
      queries.push({ text, values: values ?? [] });
      const responder = responses.find((r) => r.match(text));
      return {
        rows: responder?.rows ?? [],
        rowCount: responder?.rows.length ?? 0,
        command: '',
        oid: 0,
        fields: [],
      } as unknown as QueryResult;
    },
    release() {},
  } as unknown as PoolClient;
  return { client, queries };
}

describe('batchResolveLabels', () => {
  test('returns empty map when no requests are provided', async () => {
    const { client, queries } = createMockClient([]);
    const result = await batchResolveLabels(client, [], 'user-1');
    expect(result.size).toBe(0);
    expect(queries).toHaveLength(0);
  });

  test('uses a single SELECT for all unique label lookups', async () => {
    const { client, queries } = createMockClient([
      {
        match: (t) => t.includes('SELECT l.id'),
        rows: [
          { id: 'lbl-bottle', type: 'object', lower_name: 'bottle' },
          { id: 'lbl-plastic', type: 'material', lower_name: 'plastic' },
        ],
      },
    ]);

    const result = await batchResolveLabels(
      client,
      [
        { type: 'object', enName: 'Bottle' },
        { type: 'material', enName: 'Plastic' },
      ],
      'user-1',
    );

    const selectQueries = queries.filter((q) => q.text.includes('SELECT l.id'));
    expect(selectQueries).toHaveLength(1);
    expect(result.get('object:bottle')).toBe('lbl-bottle');
    expect(result.get('material:plastic')).toBe('lbl-plastic');
  });

  test('inserts missing labels and returns their ids', async () => {
    let rereadCount = 0;
    const { client, queries } = createMockClient([
      { match: (t) => t.includes('SELECT l.id') && t.includes('LIMIT 1'), rows: [{ id: `lbl-${++rereadCount}` }] as QueryResultRow[] },
      { match: (t) => t.includes('SELECT l.id'), rows: [] },
      { match: (t) => t.startsWith('INSERT INTO labels'), rows: [] },
      { match: (t) => t.startsWith('INSERT INTO label_translations'), rows: [] },
    ]);

    const result = await batchResolveLabels(
      client,
      [{ type: 'object', enName: 'Wrapper' }],
      'user-1',
    );

    expect(queries.some((q) => q.text.startsWith('INSERT INTO labels'))).toBe(true);
    expect(queries.some((q) => q.text.startsWith('INSERT INTO label_translations'))).toBe(true);
    expect(result.get('object:wrapper')).toMatch(/^lbl-\d+$/);
  });
});

describe('insertDetectedItems', () => {
  test('inserts all items in a single multi-row INSERT', async () => {
    const { client, queries } = createMockClient([]);
    const labelMap = new Map<string, string>([
      ['object:bottle', 'lbl-bottle'],
      ['material:plastic', 'lbl-plastic'],
    ]);

    await insertDetectedItems(
      client,
      'spot-1',
      [
        { category: 'Bottle', material: 'Plastic', brand: null, weightGrams: 10, confidence: 0.9 },
        { category: 'Bottle', material: null, brand: null, weightGrams: 12, confidence: 0.8 },
      ],
      labelMap,
      'gpt-4o-mini',
      'user-1',
    );

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain('INSERT INTO detected_items');
    expect(queries[0].values).toHaveLength(2 * 10);
  });

  test('no-ops when there are no objects', async () => {
    const { client, queries } = createMockClient([]);
    await insertDetectedItems(client, 'spot-1', [], new Map(), 'gpt-4o-mini', 'user-1');
    expect(queries).toHaveLength(0);
  });
});

describe('persistDetection', () => {
  test('runs delete, label resolve, multi-row insert, and spot update in order', async () => {
    const { client, queries } = createMockClient([
      { match: (t) => t.startsWith('DELETE FROM detected_items'), rows: [] },
      { match: (t) => t.includes('SELECT l.id') && t.includes('LIMIT 1'), rows: [{ id: 'lbl-x' }] },
      { match: (t) => t.includes('SELECT l.id'), rows: [] },
      { match: (t) => t.startsWith('INSERT INTO labels'), rows: [] },
      { match: (t) => t.startsWith('INSERT INTO label_translations'), rows: [] },
      { match: (t) => t.includes('INSERT INTO detected_items'), rows: [] },
      { match: (t) => t.includes('UPDATE spots'), rows: [] },
    ]);

    await persistDetection(
      client,
      'spot-1',
      'user-1',
      {
        objects: [
          { category: 'Bottle', material: null, brand: null, weightGrams: 5, confidence: 0.7 },
        ],
        notes: 'one bottle',
      },
      'gpt-4o-mini',
    );

    const ops = queries.map((q) => q.text.trim().split(/\s+/).slice(0, 3).join(' '));
    expect(ops[0]).toBe('DELETE FROM detected_items');
    expect(ops[ops.length - 1].startsWith('UPDATE spots')).toBe(true);
    expect(queries.find((q) => q.text.includes('INSERT INTO detected_items'))).toBeDefined();
  });

  test('skips item insertion when detection has no objects', async () => {
    const { client, queries } = createMockClient([
      { match: (t) => t.startsWith('DELETE FROM detected_items'), rows: [] },
      { match: (t) => t.includes('UPDATE spots'), rows: [] },
    ]);

    await persistDetection(
      client,
      'spot-1',
      'user-1',
      { objects: [], notes: null },
      'gpt-4o-mini',
    );

    expect(queries.some((q) => q.text.includes('INSERT INTO detected_items'))).toBe(false);
    expect(queries.some((q) => q.text.includes('UPDATE spots'))).toBe(true);
  });
});
