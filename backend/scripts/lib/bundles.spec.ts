import { describe, expect, test } from 'bun:test';
import {
  isCapExceeded,
  mergeRows,
  planImageSync,
  planTableSync,
  referencedImageKeys,
  rowKey,
  sourceLabel,
  type Row,
} from './bundles';

describe('rowKey', () => {
  test('uses the value for a single key and a JSON array for composite keys', () => {
    expect(rowKey({ id: 'a', x: 1 }, ['id'])).toBe('a');
    expect(rowKey({ team_id: 't', user_id: 'u' }, ['team_id', 'user_id'])).toBe('["t","u"]');
    expect(rowKey({ id: 7 }, ['id'])).toBe('7');
  });
});

describe('planTableSync', () => {
  test('fetches new and changed rows and removes vanished ones', () => {
    const plan = planTableSync(new Set(['a', 'b', 'c']), { a: 'h1', b: 'h2', c: 'h3' }, { a: 'h1', b: 'h2x', d: 'h4' });
    expect(plan.fetch.sort()).toEqual(['b', 'd']);
    expect(plan.remove).toEqual(['c']);
  });

  test('without previous hashes fetches every row once', () => {
    const plan = planTableSync(new Set(['a']), undefined, { a: 'h1', b: 'h2' });
    expect(plan.fetch.sort()).toEqual(['a', 'b']);
    expect(plan.remove).toEqual([]);
  });

  test('refetches a row whose hash is known but whose local copy is missing', () => {
    const plan = planTableSync(new Set(), { a: 'h1' }, { a: 'h1' });
    expect(plan.fetch).toEqual(['a']);
  });

  test('does nothing when nothing changed', () => {
    const plan = planTableSync(new Set(['a']), { a: 'h1' }, { a: 'h1' });
    expect(plan).toEqual({ fetch: [], remove: [] });
  });
});

describe('mergeRows', () => {
  const keyOf = (row: Row) => String(row.id);

  test('adds, updates, archives and sorts by key', () => {
    const existing = [{ id: 'c', v: 1 }, { id: 'a', v: 1 }, { id: 'b', v: 1 }];
    const result = mergeRows(existing, [{ id: 'b', v: 2 }, { id: 'd', v: 1 }], new Set(['c']), keyOf);
    expect(result.rows).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'd', v: 1 }]);
    expect(result.removed).toEqual([{ id: 'c', v: 1 }]);
    expect(result.stats).toEqual({ added: 1, updated: 1, unchanged: 0, deleted: 1 });
  });

  test('counts an identical refetched row as unchanged', () => {
    const result = mergeRows([{ id: 'a', v: { n: 1 } }], [{ id: 'a', v: { n: 1 } }], new Set(), keyOf);
    expect(result.stats).toEqual({ added: 0, updated: 0, unchanged: 1, deleted: 0 });
  });

  test('ignores removals of keys it does not hold', () => {
    const result = mergeRows([{ id: 'a' }], [], new Set(['zzz']), keyOf);
    expect(result.rows).toEqual([{ id: 'a' }]);
    expect(result.stats.deleted).toBe(0);
  });
});

describe('image sync', () => {
  test('collects originals and thumbnails, skipping empty keys', () => {
    const keys = referencedImageKeys([
      { image_key: 'spots/1/o.jpg', thumbnail_key: 'spots/1/t.jpg' },
      { image_key: 'spots/2/o.jpg', thumbnail_key: null },
      { image_key: '' },
    ]);
    expect([...keys].sort()).toEqual(['spots/1/o.jpg', 'spots/1/t.jpg', 'spots/2/o.jpg']);
  });

  test('downloads only what is missing and archives what nothing references', () => {
    const plan = planImageSync(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'old']));
    expect(plan).toEqual({ download: ['a'], orphaned: ['old'] });
  });
});

describe('isCapExceeded', () => {
  test('recognises the Backblaze cap answer and nothing else', () => {
    expect(
      isCapExceeded(new Error('Cannot download file, download bandwidth or transaction (Class B) cap exceeded. See the Caps & Alerts page')),
    ).toBe(true);
    expect(isCapExceeded('Transaction cap exceeded')).toBe(true);
    expect(isCapExceeded(new Error('The operation was aborted.'))).toBe(false);
    expect(isCapExceeded(new Error('NoSuchKey'))).toBe(false);
  });
});

describe('sourceLabel', () => {
  test('names loopback hosts local, which is why a tunnelled prod run passes --source', () => {
    expect(sourceLabel('127.0.0.1')).toBe('local');
    expect(sourceLabel('db.example.org')).toBe('db-example-org');
  });
});
