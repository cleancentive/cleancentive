import { describe, expect, test } from 'bun:test';
import { BadRequestException, HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hashSecretToken } from '../common/secret-token';
import type { ApiKey } from './api-key.entity';
import { ApiKeyService } from './api-key.service';

type Row = Partial<ApiKey>;

function makeService(rows: Row[] = [], emails: string[] = ['dev@example.org']) {
  const saved: Row[] = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const updates: Array<{ where: Record<string, unknown>; patch: Record<string, unknown> }> = [];
  const limited: Array<{ key: string; max: number }> = [];
  const repository = {
    create: (input: Row) => ({ ...input }),
    save: async (input: Row) => {
      const row = { id: `key-${saved.length + 1}`, created_at: new Date(), last_used_at: null, revoked_at: null, ...input };
      saved.push(row);
      return row;
    },
    findOne: async ({ where }: { where: Row }) =>
      rows.find((r) =>
        Object.entries(where).every(([field, value]) =>
          typeof value === 'object' && value !== null && !(value instanceof Date)
            ? r[field as keyof Row] === null
            : r[field as keyof Row] === value,
        ),
      ) ?? null,
    update: async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
      updates.push({ where, patch });
    },
    count: async () => rows.filter((r) => r.revoked_at === null).length,
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return rows.map((r) => ({ ...r, spot_count: 3 }));
    },
  };
  const userEmailRepository = {
    find: async () => emails.map((email) => ({ email, is_selected_for_login: true })),
  };
  const service = Object.create(ApiKeyService.prototype) as ApiKeyService;
  const inject = service as unknown as Record<string, unknown>;
  inject.apiKeyRepository = repository;
  inject.userEmailRepository = userEmailRepository;
  inject.limiter = {
    check: async (key: string, max: number) => {
      limited.push({ key, max });
      if (max === 0) throw new HttpException('budget', 429);
    },
  };
  return { service, saved, updates, limited, queries };
}

const PLAINTEXT = 'cc_live_' + 'b'.repeat(43);

function liveKey(overrides: Row = {}): Row {
  return {
    id: 'key-1',
    name: 'Litter Wars',
    key_prefix: 'cc_live_bbbbbbbb',
    key_hash: hashSecretToken(PLAINTEXT),
    scopes: ['read', 'write:spots'],
    rate_limit_per_minute: 120,
    revoked_at: null,
    expires_at: null,
    last_used_at: null,
    ...overrides,
  };
}

describe('ApiKeyService.create', () => {
  test('returns the key once and stores prefix, hash, scopes and issuer', async () => {
    const { service, saved } = makeService();

    const created = await service.create(
      { name: ' Litter Wars ', contactEmail: 'team@example.org', scopes: ['read', 'write:spots', 'read'] },
      'steward-1',
    );

    expect(created.key).toMatch(/^cc_live_[A-Za-z0-9_-]{43}$/);
    expect(created.keyPrefix).toBe(created.key.slice(0, 16));
    expect(created.scopes).toEqual(['read', 'write:spots']);
    expect(created.rateLimitPerMinute).toBe(60);
    expect(saved[0].owner_user_id).toBe('steward-1');
    expect(saved[0].key_hash).toBe(hashSecretToken(created.key));
    expect(JSON.stringify(saved[0])).not.toContain(created.key);
  });

  test('rejects unknown scopes, bad emails and out-of-range limits', async () => {
    const { service } = makeService();
    const base = { name: 'x', contactEmail: 'a@b.c', scopes: ['read' as const] };

    await expect(service.create({ ...base, scopes: ['admin' as never] }, 's')).rejects.toThrow(BadRequestException);
    await expect(service.create({ ...base, scopes: [] }, 's')).rejects.toThrow(BadRequestException);
    await expect(service.create({ ...base, contactEmail: 'nope' }, 's')).rejects.toThrow(BadRequestException);
    await expect(service.create({ ...base, rateLimitPerMinute: 0 }, 's')).rejects.toThrow(BadRequestException);
    await expect(service.create({ ...base, expiresInDays: 0 }, 's')).rejects.toThrow(BadRequestException);
  });
});

describe('ApiKeyService.authenticate', () => {
  test('resolves a live key to its identity and scopes', async () => {
    const { service, updates } = makeService([liveKey()]);

    expect(await service.authenticate(PLAINTEXT)).toEqual({
      id: 'key-1',
      name: 'Litter Wars',
      scopes: ['read', 'write:spots'],
      rateLimitPerMinute: 120,
    });
    expect(updates[0].patch.last_used_at).toBeInstanceOf(Date);
  });

  test('rejects unknown, revoked and expired keys', async () => {
    const unknown = makeService([]);
    const revoked = makeService([liveKey({ revoked_at: new Date() })]);
    const expired = makeService([liveKey({ expires_at: new Date(Date.now() - 1_000) })]);

    await expect(unknown.service.authenticate(PLAINTEXT)).rejects.toThrow(UnauthorizedException);
    await expect(revoked.service.authenticate(PLAINTEXT)).rejects.toThrow(UnauthorizedException);
    await expect(expired.service.authenticate(PLAINTEXT)).rejects.toThrow(UnauthorizedException);
  });
});

describe('ApiKeyService.enforceRateLimit', () => {
  test('budgets per key with the limit stored on it', async () => {
    const { service, limited } = makeService();

    await service.enforceRateLimit({ id: 'key-1', name: 'x', scopes: ['read'], rateLimitPerMinute: 120 });

    expect(limited).toEqual([{ key: 'api-key:key-1', max: 120 }]);
  });
});

describe('ApiKeyService.list and revoke', () => {
  test('lists keys with their spot counts and never the hash as a key', async () => {
    const { service } = makeService([liveKey()]);

    const [summary] = await service.list();

    expect(summary.spotCount).toBe(3);
    expect(summary.keyPrefix).toBe('cc_live_bbbbbbbb');
    expect(Object.keys(summary)).not.toContain('key_hash');
  });

  test('revokes once and then reports the key as gone', async () => {
    const { service, updates } = makeService([liveKey()]);

    await service.revoke('key-1');
    expect(updates[0].patch.revoked_at).toBeInstanceOf(Date);

    await expect(service.revoke('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('ApiKeyService self-service', () => {
  test('a developer gets a key with their sign-in address as contact and the default budget', async () => {
    const { service, saved } = makeService([], ['me@example.org', 'other@example.org']);
    const created = await service.createForOwner('user-1', { name: 'My game', scopes: ['write:spots'] });
    expect(created.key.startsWith('cc_live_')).toBe(true);
    expect(created.contactEmail).toBe('me@example.org');
    expect(created.rateLimitPerMinute).toBe(60);
    expect(saved[0].owner_user_id).toBe('user-1');
  });

  test('needs an email address and stops at ten active keys', async () => {
    const { service: guest } = makeService([], []);
    await expect(guest.createForOwner('guest-1', { name: 'x', scopes: ['read'] })).rejects.toThrow(BadRequestException);

    const tenKeys = Array.from({ length: 10 }, (_, i) => liveKey({ id: `key-${i}`, owner_user_id: 'user-1' }));
    const { service: full } = makeService(tenKeys);
    await expect(full.createForOwner('user-1', { name: 'x', scopes: ['read'] })).rejects.toThrow(/10 active/);
  });

  test('lists only the owner’s live keys and revokes only those', async () => {
    const { service, queries, updates } = makeService([liveKey({ owner_user_id: 'user-1' })]);
    const listed = await service.listForOwner('user-1');
    expect(listed).toHaveLength(1);
    expect(queries[0].sql).toContain('k.owner_user_id = $1 AND k.revoked_at IS NULL');
    expect(queries[0].params).toEqual(['user-1']);

    await expect(service.revokeForOwner('someone-else', 'key-1')).rejects.toThrow(NotFoundException);
    await service.revokeForOwner('user-1', 'key-1');
    expect(updates[0].patch.revoked_at).toBeInstanceOf(Date);
  });

  test('a steward changes the budget of a live key within bounds', async () => {
    const { service, updates } = makeService([liveKey()]);
    await service.updateRateLimit('key-1', 600);
    expect(updates[0]).toEqual({ where: { id: 'key-1' }, patch: { rate_limit_per_minute: 600 } });
    await expect(service.updateRateLimit('key-1', 0)).rejects.toThrow(BadRequestException);
    await expect(service.updateRateLimit('missing', 60)).rejects.toThrow(NotFoundException);
  });
});
