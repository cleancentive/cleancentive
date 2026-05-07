import { describe, expect, test } from 'bun:test';

import { SpotService } from './spot.service';
import type { Spot } from './spot.entity';

type QueryBuilderCalls = {
  orderBy: Array<[string, string]>;
  addOrderBy: Array<[string, string]>;
  take: number | null;
  andWhere: Array<{ clause: string; params: Record<string, unknown> }>;
};

function makeSpot(captured_at: string, id: string): Spot {
  return {
    id,
    captured_at: new Date(captured_at),
    items: [],
  } as unknown as Spot;
}

function makeRepository(rows: Spot[]) {
  const calls: QueryBuilderCalls = { orderBy: [], addOrderBy: [], take: null, andWhere: [] };

  const qb: Record<string, unknown> = {};
  Object.assign(qb, {
    leftJoinAndSelect: () => qb,
    where: () => qb,
    orderBy: (field: string, dir: string) => { calls.orderBy.push([field, dir]); return qb; },
    addOrderBy: (field: string, dir: string) => { calls.addOrderBy.push([field, dir]); return qb; },
    take: (n: number) => { calls.take = n; return qb; },
    andWhere: (clause: string, params: Record<string, unknown>) => {
      calls.andWhere.push({ clause, params });
      return qb;
    },
    getMany: async () => rows,
  });

  return {
    repository: { createQueryBuilder: () => qb } as never,
    calls,
  };
}

function makeService(rows: Spot[]) {
  const { repository, calls } = makeRepository(rows);
  const service = Object.create(SpotService.prototype) as SpotService;
  (service as unknown as { spotRepository: unknown }).spotRepository = repository;
  return { service, calls };
}

describe('SpotService.listSpotsForUser cursor pagination', () => {
  test('orders by (captured_at DESC, id DESC) and fetches limit + 1', async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      makeSpot(`2026-05-${String(10 - i).padStart(2, '0')}T00:00:00.000Z`, `id-${i}`),
    );
    const { service, calls } = makeService(rows);

    await service.listSpotsForUser('user-1', 3);

    expect(calls.orderBy).toEqual([['spot.captured_at', 'DESC']]);
    expect(calls.addOrderBy).toEqual([['spot.id', 'DESC']]);
    expect(calls.take).toBe(4);
  });

  test('returns nextCursor encoding last item when more rows exist', async () => {
    const rows = [
      makeSpot('2026-05-10T00:00:00.000Z', 'id-a'),
      makeSpot('2026-05-09T00:00:00.000Z', 'id-b'),
      makeSpot('2026-05-08T00:00:00.000Z', 'id-c'),
      makeSpot('2026-05-07T00:00:00.000Z', 'id-d'),
    ];
    const { service } = makeService(rows);

    const page = await service.listSpotsForUser('user-1', 3);

    expect(page.items).toHaveLength(3);
    expect(page.items.map((s) => s.id)).toEqual(['id-a', 'id-b', 'id-c']);
    expect(page.nextCursor).toBe('2026-05-08T00:00:00.000Z|id-c');
  });

  test('returns nextCursor null on the last page', async () => {
    const rows = [
      makeSpot('2026-05-10T00:00:00.000Z', 'id-a'),
      makeSpot('2026-05-09T00:00:00.000Z', 'id-b'),
    ];
    const { service } = makeService(rows);

    const page = await service.listSpotsForUser('user-1', 5);

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  test('applies before cursor as a tuple comparison', async () => {
    const { service, calls } = makeService([]);

    await service.listSpotsForUser('user-1', 3, {
      before: '2026-05-08T00:00:00.000Z|id-c',
    });

    const beforeAndWhere = calls.andWhere.find((w) =>
      w.clause.includes('spot.captured_at') && w.clause.includes('spot.id'),
    );
    expect(beforeAndWhere).toBeDefined();
    expect(beforeAndWhere?.clause).toBe('(spot.captured_at, spot.id) < (:beforeAt, :beforeId)');
    expect(beforeAndWhere?.params).toEqual({
      beforeAt: '2026-05-08T00:00:00.000Z',
      beforeId: 'id-c',
    });
  });

  test('ignores malformed before cursor', async () => {
    const { service, calls } = makeService([]);

    await service.listSpotsForUser('user-1', 3, { before: 'no-pipe' });

    const tupleClause = calls.andWhere.find((w) => w.clause.includes('spot.captured_at, spot.id'));
    expect(tupleClause).toBeUndefined();
  });

  test('cursor consistency: page 2 with cursor skips an inserted newer spot', async () => {
    // Page 1 returns 3 items + nextCursor, ignoring a spot inserted later that's newer than the page-1 head.
    const page1Rows = [
      makeSpot('2026-05-10T00:00:00.000Z', 'id-a'),
      makeSpot('2026-05-09T00:00:00.000Z', 'id-b'),
      makeSpot('2026-05-08T00:00:00.000Z', 'id-c'),
      makeSpot('2026-05-07T00:00:00.000Z', 'id-d'),
    ];
    const page1 = await makeService(page1Rows).service.listSpotsForUser('user-1', 3);
    expect(page1.nextCursor).toBe('2026-05-08T00:00:00.000Z|id-c');

    // Between requests, a newer spot is inserted. Page 2 fetched with the cursor must not see it.
    const page2Rows = [
      makeSpot('2026-05-07T00:00:00.000Z', 'id-d'),
    ];
    const { service: page2Service, calls: page2Calls } = makeService(page2Rows);
    const page2 = await page2Service.listSpotsForUser('user-1', 3, { before: page1.nextCursor! });

    expect(page2.items.map((s) => s.id)).toEqual(['id-d']);
    expect(page2.nextCursor).toBeNull();
    // The newer-than-page-1 spot is excluded by the WHERE predicate the service constructed:
    const beforePredicate = page2Calls.andWhere.find((w) => w.clause.includes('(spot.captured_at, spot.id)'));
    expect(beforePredicate?.params).toEqual({
      beforeAt: '2026-05-08T00:00:00.000Z',
      beforeId: 'id-c',
    });
  });
});
