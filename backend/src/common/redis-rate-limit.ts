import { HttpException, HttpStatus } from '@nestjs/common';
import type Redis from 'ioredis';

/**
 * A fixed-window counter kept in Redis.
 *
 * The in-memory limiter in rate-limit.ts is right for budget guards on mail
 * and telemetry, where a reset on restart costs nothing. This one is for
 * limits that must hold across restarts and replicas, and whose callers
 * already depend on Redis being up: spot creation needs it for the detection
 * queue, so failing closed here adds no new way to be down.
 */
export interface RedisRateLimiter {
  /** Counts one hit for `key` and throws 429 once the window holds more than `max`. */
  check(key: string, max: number): Promise<void>;
}

export function createRedisRateLimiter(
  redis: Redis,
  options: { windowMs: number; message: string },
): RedisRateLimiter {
  return {
    async check(key: string, max: number): Promise<void> {
      const window = Math.floor(Date.now() / options.windowMs);
      const redisKey = `rate-limit:${key}:${window}`;
      const replies = await redis.multi().incr(redisKey).pexpire(redisKey, options.windowMs).exec();
      const count = Number(replies?.[0]?.[1] ?? 0);
      if (count > max) {
        throw new HttpException(options.message, HttpStatus.TOO_MANY_REQUESTS);
      }
    },
  };
}
