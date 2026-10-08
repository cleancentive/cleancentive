import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import type Redis from 'ioredis';

import { clearInsightsCache } from './insights-cache';

function makeRedis(batches: string[][]) {
  const unlinked: string[][] = [];
  let keysCalled = false;
  const redis = {
    scanStream: () => Readable.from(batches),
    unlink: async (...keys: string[]) => {
      unlinked.push(keys);
      return keys.length;
    },
    keys: async () => {
      keysCalled = true;
      return [];
    },
  } as unknown as Redis;
  return { redis, unlinked, isKeysCalled: () => keysCalled };
}

describe('clearInsightsCache', () => {
  test('unlinks every key the scan yields, batch by batch', async () => {
    const { redis, unlinked, isKeysCalled } = makeRedis([
      ['insights:stats:a', 'insights:map:b'],
      ['insights:leaderboard:c'],
    ]);

    await clearInsightsCache(redis);

    expect(unlinked).toEqual([
      ['insights:stats:a', 'insights:map:b'],
      ['insights:leaderboard:c'],
    ]);
    expect(isKeysCalled()).toBe(false);
  });

  test('skips empty scan batches', async () => {
    const { redis, unlinked } = makeRedis([[], ['insights:stats:a'], []]);

    await clearInsightsCache(redis);

    expect(unlinked).toEqual([['insights:stats:a']]);
  });
});
