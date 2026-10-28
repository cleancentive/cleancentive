import { describe, expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';
import type Redis from 'ioredis';
import { RateLimitExceededException, createRedisRateLimiter } from './redis-rate-limit';

function makeRedis() {
  const counters = new Map<string, number>();
  const expiries: Array<{ key: string; ms: number }> = [];
  let pendingKey = '';
  const multi = {
    incr(key: string) {
      pendingKey = key;
      counters.set(key, (counters.get(key) ?? 0) + 1);
      return multi;
    },
    pexpire(key: string, ms: number) {
      expiries.push({ key, ms });
      return multi;
    },
    async exec() {
      return [[null, counters.get(pendingKey)], [null, 1]];
    },
  };
  const redis = { multi: () => multi } as unknown as Redis;
  return { redis, counters, expiries };
}

describe('createRedisRateLimiter', () => {
  test('allows up to max hits in a window and rejects the next one', async () => {
    const { redis } = makeRedis();
    const limiter = createRedisRateLimiter(redis, { windowMs: 60_000, message: 'slow down' });

    await limiter.check('spots:user:u1', 2);
    await limiter.check('spots:user:u1', 2);

    await expect(limiter.check('spots:user:u1', 2)).rejects.toThrow(HttpException);
    await expect(limiter.check('spots:user:u1', 2)).rejects.toMatchObject({ status: 429 });
  });

  test('tells the caller how many seconds remain in the window', async () => {
    const { redis } = makeRedis();
    const limiter = createRedisRateLimiter(redis, { windowMs: 60_000, message: 'slow down' });
    await limiter.check('api-key:k1', 1);

    let error: unknown;
    await limiter.check('api-key:k1', 1).catch((e: unknown) => { error = e; });
    expect(error).toBeInstanceOf(RateLimitExceededException);
    const remaining = 60 - (Math.floor(Date.now() / 1000) % 60);
    const retryAfter = (error as RateLimitExceededException).retryAfterSeconds;
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(remaining + 1);
  });

  test('keeps counters per key and expires each window', async () => {
    const { redis, counters, expiries } = makeRedis();
    const limiter = createRedisRateLimiter(redis, { windowMs: 60_000, message: 'slow down' });

    await limiter.check('spots:user:u1', 1);
    await limiter.check('spots:user:u2', 1);

    expect([...counters.keys()].every((key) => key.startsWith('rate-limit:spots:user:u'))).toBe(true);
    expect(counters.size).toBe(2);
    expect(expiries.every((entry) => entry.ms === 60_000)).toBe(true);
  });
});
