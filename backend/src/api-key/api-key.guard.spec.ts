import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard, RequireApiKeyScope } from './api-key.guard';
import type { ResolvedApiKey } from './api-key.service';

const KEY: ResolvedApiKey = { id: 'key-1', name: 'Litter Wars', scopes: ['read'], rateLimitPerMinute: 60 };

class Handlers {
  @RequireApiKeyScope('write:spots')
  write() {}
  read() {}
}

function makeGuard(authenticate: (raw: string) => Promise<ResolvedApiKey>) {
  const limited: string[] = [];
  const apiKeys = {
    authenticate,
    enforceRateLimit: async (key: ResolvedApiKey) => {
      limited.push(key.id);
    },
  };
  return { guard: new ApiKeyGuard(apiKeys as never, new Reflector()), limited };
}

function contextFor(headers: Record<string, string>, handler: (...args: unknown[]) => unknown) {
  const request: Record<string, unknown> = { headers, user: { userId: 'u1' } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('ApiKeyGuard', () => {
  test('passes a request without the header untouched', async () => {
    const { guard, limited } = makeGuard(async () => KEY);
    const { context, request } = contextFor({}, Handlers.prototype.write);

    expect(await guard.canActivate(context)).toBe(true);
    expect(request.apiKey).toBeUndefined();
    expect(limited).toEqual([]);
  });

  test('refuses a bad key even where no scope is required', async () => {
    const { guard } = makeGuard(async () => {
      throw new UnauthorizedException('Invalid or revoked API key');
    });
    const { context } = contextFor({ 'x-api-key': 'cc_live_bad' }, Handlers.prototype.read);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  test('attaches the key, budgets it, and leaves req.user alone', async () => {
    const { guard, limited } = makeGuard(async () => KEY);
    const { context, request } = contextFor({ 'x-api-key': ' cc_live_ok ' }, Handlers.prototype.read);

    expect(await guard.canActivate(context)).toBe(true);
    expect(request.apiKey).toEqual(KEY);
    expect(request.user).toEqual({ userId: 'u1' });
    expect(limited).toEqual(['key-1']);
  });

  test('enforces the scope a handler requires', async () => {
    const { guard } = makeGuard(async () => KEY);
    const denied = contextFor({ 'x-api-key': 'cc_live_ok' }, Handlers.prototype.write);
    await expect(guard.canActivate(denied.context)).rejects.toThrow(ForbiddenException);

    const { guard: writer } = makeGuard(async () => ({ ...KEY, scopes: ['read', 'write:spots'] }));
    const allowed = contextFor({ 'x-api-key': 'cc_live_ok' }, Handlers.prototype.write);
    expect(await writer.canActivate(allowed.context)).toBe(true);
  });
});
