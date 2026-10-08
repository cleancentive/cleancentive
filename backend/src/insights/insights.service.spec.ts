import { describe, expect, test } from 'bun:test';
import { InsightsService } from './insights.service';

function makeService(rows: Record<string, unknown>[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const cache = new Map<string, string>();
  const service = Object.create(InsightsService.prototype) as InsightsService;
  const inject = service as unknown as Record<string, unknown>;
  inject.spotRepository = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return rows;
    },
  };
  inject.redis = {
    get: async (key: string) => cache.get(key) ?? null,
    set: async (key: string, value: string) => { cache.set(key, value); return 'OK'; },
  };
  return { service, queries, cache };
}

describe('InsightsService.getLeaderboard', () => {
  test('counts picked-up litter only, bounded by the time range', async () => {
    const { service, queries } = makeService([]);

    await service.getLeaderboard({ cleanupId: 'c1', since: '2026-10-30T00:00:00Z', before: '2026-11-02T00:00:00Z' });

    const { sql, params } = queries[0];
    expect(sql).toContain('cleanup_date_id IN (SELECT id FROM cleanup_dates WHERE cleanup_id = $1)');
    expect(sql).toContain('s.captured_at >= $2');
    expect(sql).toContain('s.captured_at < $3');
    expect(sql).toContain('s.picked_up = $4');
    expect(sql).toContain('s.subject_kind = $5');
    expect(params).toEqual(['c1', '2026-10-30T00:00:00Z', '2026-11-02T00:00:00Z', true, 'litter']);
    expect(sql).toContain('t.is_unlisted = false');
  });

  test('coerces numbers and keeps the unassigned row', async () => {
    const { service } = makeService([
      { team_id: 't1', team_name: 'River Crew', picks: '4', items: '9', total_weight_grams: '1200.5', last_pick_at: new Date('2026-10-31T12:00:00Z') },
      { team_id: null, team_name: null, picks: '1', items: '0', total_weight_grams: '0', last_pick_at: null },
    ]);

    const rows = await service.getLeaderboard({});

    expect(rows).toEqual([
      { teamId: 't1', teamName: 'River Crew', picks: 4, items: 9, totalWeightGrams: 1200.5, lastPickAt: '2026-10-31T12:00:00.000Z' },
      { teamId: null, teamName: null, picks: 1, items: 0, totalWeightGrams: 0, lastPickAt: null },
    ]);
  });

  test('caches under the insights prefix so spot events clear it', async () => {
    const { service, cache, queries } = makeService([]);

    await service.getLeaderboard({ cleanupDateId: 'd1' });
    await service.getLeaderboard({ cleanupDateId: 'd1' });

    expect([...cache.keys()]).toEqual(['insights:leaderboard:cd:d1']);
    expect(queries).toHaveLength(1);
  });
});
