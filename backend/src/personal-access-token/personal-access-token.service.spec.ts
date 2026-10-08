import { describe, expect, test } from 'bun:test';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hashSecretToken } from '../common/secret-token';
import type { PersonalAccessToken } from './personal-access-token.entity';
import { PersonalAccessTokenService } from './personal-access-token.service';

type Row = Partial<PersonalAccessToken>;

function makeService(rows: Row[] = []) {
  const updates: Array<{ where: Record<string, unknown>; patch: Record<string, unknown> }> = [];
  const saved: Row[] = [];
  const repository = {
    count: async () => rows.filter((r) => !r.revoked_at).length,
    create: (input: Row) => ({ ...input }),
    save: async (input: Row) => {
      const row = { id: `id-${saved.length + 1}`, created_at: new Date(), last_used_at: null, revoked_at: null, ...input };
      saved.push(row);
      return row;
    },
    find: async () => rows.filter((r) => !r.revoked_at),
    findOne: async ({ where }: { where: Row }) =>
      rows.find((r) =>
        Object.entries(where).every(([key, value]) =>
          // IsNull() from typeorm is an object; the fake treats it as "must be null".
          typeof value === 'object' && value !== null && !(value instanceof Date)
            ? r[key as keyof Row] === null
            : r[key as keyof Row] === value,
        ),
      ) ?? null,
    update: async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
      updates.push({ where, patch });
    },
  };
  const service = Object.create(PersonalAccessTokenService.prototype) as PersonalAccessTokenService;
  (service as unknown as { tokenRepository: unknown }).tokenRepository = repository;
  return { service, saved, updates };
}

const PLAINTEXT = 'cc_pat_' + 'a'.repeat(43);

function liveToken(overrides: Row = {}): Row {
  return {
    id: 'tok-1',
    user_id: 'user-1',
    token_hash: hashSecretToken(PLAINTEXT),
    revoked_at: null,
    expires_at: null,
    last_used_at: null,
    ...overrides,
  };
}

describe('PersonalAccessTokenService.create', () => {
  test('returns the plaintext once and stores only prefix and hash', async () => {
    const { service, saved } = makeService();

    const created = await service.create('user-1', { name: '  litter-wars backend ' });

    expect(created.token).toMatch(/^cc_pat_[A-Za-z0-9_-]{43}$/);
    expect(created.tokenPrefix).toBe(created.token.slice(0, 15));
    expect(created.name).toBe('litter-wars backend');
    expect(saved[0].token_hash).toBe(hashSecretToken(created.token));
    expect(JSON.stringify(saved[0])).not.toContain(created.token);
  });

  test('defaults to a 90-day expiry and honours null as never', async () => {
    const { service } = makeService();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;

    const defaulted = await service.create('user-1', { name: 'a' });
    const forever = await service.create('user-1', { name: 'b', expiresInDays: null });

    expect(defaulted.expiresAt!.getTime() - Date.now()).toBeGreaterThan(ninetyDays - 5_000);
    expect(forever.expiresAt).toBeNull();
  });

  test('rejects an empty name and an out-of-range expiry', async () => {
    const { service } = makeService();

    await expect(service.create('user-1', { name: '   ' })).rejects.toThrow(BadRequestException);
    await expect(service.create('user-1', { name: 'a', expiresInDays: 0 })).rejects.toThrow(BadRequestException);
    await expect(service.create('user-1', { name: 'a', expiresInDays: 366 })).rejects.toThrow(BadRequestException);
  });

  test('caps the number of active tokens', async () => {
    const { service } = makeService(Array.from({ length: 25 }, (_, i) => liveToken({ id: `t${i}` })));

    await expect(service.create('user-1', { name: 'one more' })).rejects.toThrow(BadRequestException);
  });
});

describe('PersonalAccessTokenService.authenticate', () => {
  test('resolves a live token to its user and records first use', async () => {
    const { service, updates } = makeService([liveToken()]);

    expect(await service.authenticate(PLAINTEXT)).toEqual({ userId: 'user-1' });
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.last_used_at).toBeInstanceOf(Date);
  });

  test('does not touch last_used_at again within the debounce window', async () => {
    const { service, updates } = makeService([liveToken({ last_used_at: new Date(Date.now() - 60_000) })]);

    await service.authenticate(PLAINTEXT);

    expect(updates).toHaveLength(0);
  });

  test('rejects unknown, revoked and expired tokens', async () => {
    const unknown = makeService([]);
    const revoked = makeService([liveToken({ revoked_at: new Date() })]);
    const expired = makeService([liveToken({ expires_at: new Date(Date.now() - 1_000) })]);

    await expect(unknown.service.authenticate(PLAINTEXT)).rejects.toThrow(UnauthorizedException);
    await expect(revoked.service.authenticate(PLAINTEXT)).rejects.toThrow(UnauthorizedException);
    await expect(expired.service.authenticate(PLAINTEXT)).rejects.toThrow(UnauthorizedException);
  });
});

describe('PersonalAccessTokenService.revoke', () => {
  test('only revokes a token the caller owns', async () => {
    const { service, updates } = makeService([liveToken()]);

    await expect(service.revoke('someone-else', 'tok-1')).rejects.toThrow(NotFoundException);
    await service.revoke('user-1', 'tok-1');

    expect(updates).toHaveLength(1);
    expect(updates[0].patch.revoked_at).toBeInstanceOf(Date);
  });
});
