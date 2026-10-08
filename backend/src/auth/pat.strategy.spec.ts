import { describe, expect, test } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { PatStrategy } from './pat.strategy';

function makeStrategy(authenticate: (token: string) => Promise<{ userId: string }>) {
  const strategy = Object.create(PatStrategy.prototype) as PatStrategy;
  (strategy as unknown as { tokens: unknown }).tokens = { authenticate };
  return strategy;
}

describe('PatStrategy.validate', () => {
  test('marks the caller as a non-guest authenticated via token', async () => {
    const strategy = makeStrategy(async () => ({ userId: 'user-1' }));

    expect(await strategy.validate('cc_pat_x')).toEqual({ userId: 'user-1', isGuest: false, authKind: 'pat' });
  });

  test('lets a rejected token surface as 401', async () => {
    const strategy = makeStrategy(async () => {
      throw new UnauthorizedException('Invalid or revoked access token');
    });

    await expect(strategy.validate('cc_pat_x')).rejects.toThrow(UnauthorizedException);
  });
});

describe('PatStrategy.authenticate (passport entry point)', () => {
  function run(authorization: string | undefined) {
    const outcome: { fail?: unknown; error?: unknown; success?: unknown } = {};
    // The passport hooks are inherited from the private BearerPatStrategy, so
    // the test reaches them through a loose shape rather than the class type.
    const strategy = Object.create(PatStrategy.prototype) as {
      fail: (code: number) => void;
      error: (err: Error) => void;
      success: (user: unknown) => void;
      verify: (token: string, done: (err: unknown, user?: unknown) => void) => void;
      authenticate: (req: unknown) => void;
    };
    strategy.fail = (code) => { outcome.fail = code; };
    strategy.error = (err) => { outcome.error = err; };
    strategy.success = (user) => { outcome.success = user; };
    strategy.verify = (token, done) => done(null, { userId: 'u', token });
    strategy.authenticate({ headers: authorization === undefined ? {} : { authorization } });
    return outcome;
  }

  test('fails quietly on a JWT bearer so the jwt strategy gets its turn', () => {
    expect(run('Bearer eyJhbGciOi.xxx.yyy')).toEqual({ fail: 401 });
  });

  test('fails quietly when there is no Authorization header', () => {
    expect(run(undefined)).toEqual({ fail: 401 });
  });

  test('hands a prefixed token to the verifier', () => {
    expect(run('Bearer cc_pat_abc').success).toEqual({ userId: 'u', token: 'cc_pat_abc' });
  });
});
