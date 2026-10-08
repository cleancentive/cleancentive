import { describe, expect, test } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { SessionOnlyGuard } from './session-only.guard';

function contextWithUser(user: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('SessionOnlyGuard', () => {
  const guard = new SessionOnlyGuard();

  test('blocks a personal access token', () => {
    expect(() => guard.canActivate(contextWithUser({ userId: 'u', isGuest: false, authKind: 'pat' }))).toThrow(
      ForbiddenException,
    );
  });

  test('passes an interactive session, guest or not', () => {
    expect(guard.canActivate(contextWithUser({ userId: 'u', isGuest: false, authKind: 'session' }))).toBe(true);
    expect(guard.canActivate(contextWithUser({ userId: 'g', isGuest: true, authKind: 'session' }))).toBe(true);
  });

  test('leaves an unauthenticated request to the guard before it', () => {
    expect(guard.canActivate(contextWithUser(undefined))).toBe(true);
  });
});
