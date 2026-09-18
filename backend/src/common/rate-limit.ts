import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

/**
 * A small fixed-window counter, held in memory.
 *
 * One backend instance runs, so a shared store would buy nothing today; move
 * this to Redis when a second one appears. Counters are per-process and reset
 * on restart, which is fine for what these limits are for.
 */
export interface RateLimiter {
  check(key: string): void;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
}): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string): void {
      const now = Date.now();

      // Fixed windows expire, but a key that is never seen again would sit in
      // the map forever. Sweep opportunistically rather than on a timer.
      if (hits.size > 10_000) {
        for (const [existing, entry] of hits) {
          if (now > entry.resetAt) hits.delete(existing);
        }
      }

      const entry = hits.get(key);
      if (!entry || now > entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + options.windowMs });
        return;
      }
      if (entry.count >= options.max) {
        throw new HttpException(options.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      entry.count++;
    },
  };
}

/**
 * The caller's address, taking the first hop of x-forwarded-for — Caddy sets it
 * in dev and in production. Only as good as the proxy in front, which is why it
 * is a budget guard and not an authorization check.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}
