import { describe, expect, test } from 'bun:test';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { SPOT_EVENTS_CHANNEL } from '@cleancentive/shared';
import { loadCompletedSpotEvent, publishSpotEvent } from './spot-events';

function dbReturning(rows: Record<string, unknown>[]) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values: values ?? [] });
      return { rows };
    },
  } as unknown as Pick<Pool, 'query'>;
  return { db, queries };
}

describe('loadCompletedSpotEvent', () => {
  test('maps the stored spot and its item summary into a public payload', async () => {
    const { db, queries } = dbReturning([
      {
        team_id: 'team-1',
        cleanup_id: null,
        cleanup_date_id: null,
        captured_at: new Date('2026-10-31T10:00:00Z'),
        latitude: '47.56',
        longitude: '7.59',
        picked_up: true,
        subject_kind: 'litter',
        item_count: 2,
        total_weight_grams: '35.5',
        top_object: 'Bottle',
      },
    ]);

    const event = await loadCompletedSpotEvent(db, 'spot-1');

    expect(event).toEqual({
      type: 'spot.completed',
      spotId: 'spot-1',
      teamId: 'team-1',
      cleanupId: null,
      cleanupDateId: null,
      capturedAt: '2026-10-31T10:00:00.000Z',
      latitude: 47.56,
      longitude: 7.59,
      pickedUp: true,
      subjectKind: 'litter',
      items: { count: 2, totalWeightGrams: 35.5, topObject: 'Bottle' },
      emittedAt: expect.any(String),
    });
    expect(Object.keys(event!)).not.toContain('userId');
    expect(queries[0].values).toEqual(['spot-1']);
  });

  test('returns null when the spot no longer exists', async () => {
    const { db } = dbReturning([]);

    expect(await loadCompletedSpotEvent(db, 'gone')).toBeNull();
  });
});

describe('publishSpotEvent', () => {
  test('publishes JSON on the shared channel', async () => {
    const published: Array<[string, string]> = [];
    const redis = { publish: async (channel: string, message: string) => { published.push([channel, message]); return 1; } } as unknown as Pick<Redis, 'publish'>;

    await publishSpotEvent(redis, {
      type: 'spot.deleted', spotId: 's', teamId: null, cleanupId: null, cleanupDateId: null,
      capturedAt: 'c', latitude: 0, longitude: 0, pickedUp: true, subjectKind: 'litter', emittedAt: 'e',
    });

    expect(published[0][0]).toBe(SPOT_EVENTS_CHANNEL);
    expect(JSON.parse(published[0][1]).type).toBe('spot.deleted');
  });
});
