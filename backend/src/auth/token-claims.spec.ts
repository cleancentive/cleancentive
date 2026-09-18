import { describe, expect, test } from 'bun:test';
import { isGuestPayload, isMagicLinkPayload, isSessionPayload } from './token-claims';

describe('isSessionPayload', () => {
  test('accepts a session token', () => {
    expect(isSessionPayload({ sub: 'u1', typ: 'session' })).toBe(true);
  });

  test('accepts a guest token', () => {
    expect(isSessionPayload({ sub: 'u1', typ: 'guest' })).toBe(true);
  });

  test('accepts a token issued before token types existed', () => {
    expect(isSessionPayload({ sub: 'u1' })).toBe(true);
  });

  test('rejects a magic link, which used to be a working session', () => {
    expect(isSessionPayload({ sub: 'u1', email: 'a@b.c', purpose: 'magic-link' })).toBe(false);
  });

  test('rejects an add-email token, which is delivered to an address the holder chose', () => {
    expect(isSessionPayload({ sub: 'u1', email: 'a@b.c', purpose: 'add-email' })).toBe(false);
  });

  test('rejects a merge confirmation', () => {
    expect(isSessionPayload({ sub: 'u1', purpose: 'merge-confirm', mergeIntoUserId: 'u2' })).toBe(false);
  });

  test('rejects an unknown token type', () => {
    expect(isSessionPayload({ sub: 'u1', typ: 'something-else' })).toBe(false);
  });

  test('rejects a token with no subject', () => {
    expect(isSessionPayload({ typ: 'session' })).toBe(false);
  });
});

describe('isMagicLinkPayload', () => {
  test('accepts a tagged magic link', () => {
    expect(isMagicLinkPayload({ sub: 'u1', email: 'a@b.c', purpose: 'magic-link' })).toBe(true);
  });

  test('accepts a link already in an inbox when token types shipped', () => {
    expect(isMagicLinkPayload({ sub: 'u1', email: 'a@b.c', requestId: 'r1' })).toBe(true);
  });

  test('rejects a session token presented as a sign-in link', () => {
    expect(isMagicLinkPayload({ sub: 'u1', typ: 'session' })).toBe(false);
  });

  test('rejects an add-email token used on the sign-in route', () => {
    expect(isMagicLinkPayload({ sub: 'u1', email: 'a@b.c', purpose: 'add-email' })).toBe(false);
  });
});

describe('isGuestPayload', () => {
  test('only a guest token is a guest', () => {
    expect(isGuestPayload({ sub: 'g1', typ: 'guest' })).toBe(true);
    expect(isGuestPayload({ sub: 'u1', typ: 'session' })).toBe(false);
    expect(isGuestPayload({ sub: 'u1' })).toBe(false);
  });
});
