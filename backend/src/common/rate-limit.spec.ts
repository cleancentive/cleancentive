import { describe, expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';
import { clientIp, createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  test('allows up to the limit and refuses the next one', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, message: 'slow down' });

    limiter.check('a');
    limiter.check('a');
    limiter.check('a');

    expect(() => limiter.check('a')).toThrow(HttpException);
  });

  test('counts each key on its own, so one caller cannot lock out another', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, message: 'slow down' });

    limiter.check('a');
    expect(() => limiter.check('b')).not.toThrow();
  });

  test('answers 429 rather than a generic error', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 0, message: 'slow down' });

    try {
      limiter.check('a');
      limiter.check('a');
      throw new Error('should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });

  test('forgets a caller once their window has passed', async () => {
    const limiter = createRateLimiter({ windowMs: 10, max: 1, message: 'slow down' });

    limiter.check('a');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(() => limiter.check('a')).not.toThrow();
  });
});

describe('clientIp', () => {
  test('takes the first hop of x-forwarded-for, which is what Caddy sets', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } } as any)).toBe(
      '203.0.113.7',
    );
  });

  test('falls back to the socket address', () => {
    expect(clientIp({ headers: {}, ip: '198.51.100.4' } as any)).toBe('198.51.100.4');
  });
});
