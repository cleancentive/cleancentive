import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AuthService } from './auth.service';
import { PendingAuthStatus } from './pending-auth-request.entity';

interface FakeUser {
  id: string;
  nickname: string;
  emails: Array<{ email: string }>;
}

function inHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function makeService(opts: {
  users?: FakeUser[];
  pending?: Array<Record<string, any>>;
  adminEmails?: string[];
} = {}) {
  const users = opts.users ?? [];
  const pending = opts.pending ?? [];
  const calls = {
    associated: [] as Array<{ userId: string; email: string }>,
    merged: [] as Array<{ from: string; to: string }>,
    mailed: [] as Array<{ email: string; link: string }>,
    promoted: [] as string[],
    saved: [] as Array<Record<string, any>>,
    updated: [] as Array<{ id: string; patch: Record<string, any> }>,
    deleted: [] as string[],
  };

  const userService = {
    findUserByEmail: async (email: string) =>
      users.find((u) => u.emails.some((e) => e.email === email)) ?? null,
    isUnclaimedGuest: async (id: string) => {
      const user = users.find((u) => u.id === id);
      if (!user) return true;
      return user.nickname === 'guest' && user.emails.length === 0;
    },
    validateAndAssociateEmail: async (userId: string, email: string) => {
      calls.associated.push({ userId, email });
      const user = users.find((u) => u.id === userId);
      if (user) user.emails.push({ email });
    },
    mergeGuestAccount: async (from: string, to: string) => {
      calls.merged.push({ from, to });
    },
    updateLastLogin: async () => undefined,
  };

  const pendingAuthRepo = {
    save: async (row: Record<string, any>) => {
      calls.saved.push(row);
      pending.push({ ...row });
      return row;
    },
    findOne: async ({ where }: any) => pending.find((r) => r.id === where.id) ?? null,
    update: async (id: string, patch: Record<string, any>) => {
      calls.updated.push({ id, patch });
      const row = pending.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
    delete: async (id: string) => {
      calls.deleted.push(id);
      const index = pending.findIndex((r) => r.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
  };

  const service = new AuthService(
    {
      sign: (payload: Record<string, unknown>) => `token(${JSON.stringify(payload)})`,
      verify: (token: string) => {
        const match = token.match(/^token\((.*)\)$/s);
        if (!match) throw new Error('bad token');
        return JSON.parse(match[1]);
      },
    } as any,
    {
      sendMagicLink: async (email: string, link: string) => {
        calls.mailed.push({ email, link });
      },
      sendRecoveryLinks: async () => undefined,
    } as any,
    userService as any,
    {
      isAdminEmail: (email: string) => (opts.adminEmails ?? []).includes(email),
      promoteToAdmin: async (userId: string) => {
        calls.promoted.push(userId);
      },
    } as any,
    { emit: () => undefined } as any,
    pendingAuthRepo as any,
    {} as any,
  );

  return { service, calls, pending, users };
}

function tokenFor(payload: Record<string, unknown>): string {
  return `token(${JSON.stringify(payload)})`;
}

describe('sendMagicLink does not write anything before the link is proven', () => {
  test('refuses to claim an account that already belongs to someone', async () => {
    const { service, calls } = makeService({
      users: [{ id: 'victim', nickname: 'Real Person', emails: [{ email: 'victim@example.com' }] }],
    });

    // The classic takeover: pass the victim's user id — public, it appears on
    // spot views and member lists — as your own guest id.
    const result = await service.sendMagicLink('attacker@example.com', 'victim');

    expect(result).toBeNull();
    expect(calls.associated).toEqual([]);
    expect(calls.mailed).toEqual([]);
  });

  test('does not attach the address at request time even for a real guest', async () => {
    const { service, calls } = makeService({
      users: [{ id: 'guest-1', nickname: 'guest', emails: [] }],
    });

    const result = await service.sendMagicLink('newcomer@example.com', 'guest-1');

    expect(result?.requestId).toBeTruthy();
    expect(calls.mailed).toHaveLength(1);
    // Attaching here is what let an unverified address sit on an account.
    expect(calls.associated).toEqual([]);
  });

  test('says nothing for an unknown address with no guest context', async () => {
    const { service, calls } = makeService();

    expect(await service.sendMagicLink('stranger@example.com')).toBeNull();
    expect(calls.mailed).toEqual([]);
  });

  test('records the requesting browser so the other device can be told who asked', async () => {
    const { service, calls } = makeService({
      users: [{ id: 'user-1', nickname: 'Someone', emails: [{ email: 'user@example.com' }] }],
    });

    await service.sendMagicLink('user@example.com', undefined, undefined, {
      browser: 'Firefox 142 on macOS',
      location: 'Zürich, Switzerland',
      requestedAt: 'Thu, 18 Sep 14:32 CEST',
    });

    expect(calls.saved[0]).toMatchObject({
      browser: 'Firefox 142 on macOS',
      location: 'Zürich, Switzerland',
      status: PendingAuthStatus.PENDING,
    });
  });
});

describe('verifyMagicLink', () => {
  test('attaches the address only now, once the inbox has been proven', async () => {
    const { service, calls } = makeService({
      users: [{ id: 'guest-1', nickname: 'guest', emails: [] }],
    });

    const result = await service.verifyMagicLink(
      tokenFor({ sub: 'guest-1', email: 'newcomer@example.com', purpose: 'magic-link' }),
    );

    expect(result.userId).toBe('guest-1');
    expect(calls.associated).toEqual([{ userId: 'guest-1', email: 'newcomer@example.com' }]);
  });

  test('signs in to the account that owns the address when it was taken meanwhile', async () => {
    const { service, calls } = makeService({
      users: [
        { id: 'guest-1', nickname: 'guest', emails: [] },
        { id: 'owner', nickname: 'Owner', emails: [{ email: 'shared@example.com' }] },
      ],
    });

    const result = await service.verifyMagicLink(
      tokenFor({ sub: 'guest-1', email: 'shared@example.com', purpose: 'magic-link' }),
    );

    expect(result.userId).toBe('owner');
    expect(calls.merged).toEqual([{ from: 'guest-1', to: 'owner' }]);
    expect(calls.associated).toEqual([]);
  });

  test('refuses a token naming an account that is not ours to claim', async () => {
    const { service } = makeService({
      users: [{ id: 'victim', nickname: 'Real Person', emails: [{ email: 'victim@example.com' }] }],
    });

    await expect(
      service.verifyMagicLink(
        tokenFor({ sub: 'victim', email: 'attacker@example.com', purpose: 'magic-link' }),
      ),
    ).rejects.toThrow('Invalid or expired magic link');
  });

  test('rejects a session token replayed on the sign-in route', async () => {
    const { service } = makeService();

    await expect(
      service.verifyMagicLink(tokenFor({ sub: 'user-1', typ: 'session' })),
    ).rejects.toThrow('Invalid or expired magic link');
  });

  test('rejects an unreadable token', async () => {
    const { service } = makeService();

    await expect(service.verifyMagicLink('not-a-token')).rejects.toThrow(
      'Invalid or expired magic link',
    );
  });

  test('promotes a steward only after the address is proven', async () => {
    const { service, calls } = makeService({
      users: [{ id: 'guest-1', nickname: 'guest', emails: [] }],
      adminEmails: ['steward@example.com'],
    });

    await service.verifyMagicLink(
      tokenFor({ sub: 'guest-1', email: 'steward@example.com', purpose: 'magic-link' }),
    );

    expect(calls.promoted).toEqual(['guest-1']);
  });
});

describe('a waiting sign-in is not completed by opening the link', () => {
  test('verify leaves the request pending and reports who started it', async () => {
    const { service, pending, calls } = makeService({
      users: [{ id: 'user-1', nickname: 'Someone', emails: [{ email: 'user@example.com' }] }],
      pending: [
        {
          id: 'req-1',
          userId: 'user-1',
          sessionToken: null,
          status: PendingAuthStatus.PENDING,
          expiresAt: inHours(1),
          browser: 'Chrome 141 on Windows',
          location: 'Bern, Switzerland',
        },
      ],
    });

    const result = await service.verifyMagicLink(
      tokenFor({
        sub: 'user-1',
        email: 'user@example.com',
        requestId: 'req-1',
        purpose: 'magic-link',
      }),
    );

    // Handing the session over here is the takeover: anyone could request a
    // link for an address they do not own and poll for the result.
    expect(pending[0].status).toBe(PendingAuthStatus.PENDING);
    expect(pending[0].sessionToken).toBeNull();
    expect(calls.updated).toEqual([]);
    expect(result.pendingSignIn).toEqual({
      requestId: 'req-1',
      browser: 'Chrome 141 on Windows',
      location: 'Bern, Switzerland',
    });
  });

  test('reports nothing to confirm when the request has already been completed', async () => {
    const { service } = makeService({
      users: [{ id: 'user-1', nickname: 'Someone', emails: [{ email: 'user@example.com' }] }],
      pending: [
        {
          id: 'req-1',
          userId: 'user-1',
          status: PendingAuthStatus.COMPLETED,
          sessionToken: 'already-handed-over',
          expiresAt: inHours(1),
        },
      ],
    });

    const result = await service.verifyMagicLink(
      tokenFor({ sub: 'user-1', email: 'user@example.com', requestId: 'req-1', purpose: 'magic-link' }),
    );

    expect(result.pendingSignIn).toBeNull();
  });

  test('reports nothing to confirm when the request has expired', async () => {
    const { service } = makeService({
      users: [{ id: 'user-1', nickname: 'Someone', emails: [{ email: 'user@example.com' }] }],
      pending: [
        {
          id: 'req-1',
          userId: 'user-1',
          status: PendingAuthStatus.PENDING,
          sessionToken: null,
          expiresAt: inHours(-1),
        },
      ],
    });

    const result = await service.verifyMagicLink(
      tokenFor({ sub: 'user-1', email: 'user@example.com', requestId: 'req-1', purpose: 'magic-link' }),
    );

    expect(result.pendingSignIn).toBeNull();
  });
});

describe('completePendingAuthFor', () => {
  test('hands the waiting device a session', async () => {
    const { service, pending } = makeService({
      pending: [
        {
          id: 'req-1',
          userId: 'user-1',
          status: PendingAuthStatus.PENDING,
          sessionToken: null,
          expiresAt: inHours(1),
        },
      ],
    });

    await service.completePendingAuthFor('req-1', 'user-1');

    expect(pending[0].status).toBe(PendingAuthStatus.COMPLETED);
    expect(pending[0].sessionToken).toContain('"typ":"session"');
  });

  test('refuses to complete a request belonging to another account', async () => {
    const { service, pending } = makeService({
      pending: [
        {
          id: 'req-1',
          userId: 'user-1',
          status: PendingAuthStatus.PENDING,
          sessionToken: null,
          expiresAt: inHours(1),
        },
      ],
    });

    await expect(service.completePendingAuthFor('req-1', 'someone-else')).rejects.toThrow(
      /different account/,
    );
    expect(pending[0].status).toBe(PendingAuthStatus.PENDING);
  });

  test('refuses an expired request and clears it', async () => {
    const { service, pending } = makeService({
      pending: [
        {
          id: 'req-1',
          userId: 'user-1',
          status: PendingAuthStatus.PENDING,
          sessionToken: null,
          expiresAt: inHours(-1),
        },
      ],
    });

    await expect(service.completePendingAuthFor('req-1', 'user-1')).rejects.toThrow(/not found/);
    expect(pending).toHaveLength(0);
  });

  test('refuses an unknown request', async () => {
    const { service } = makeService();
    await expect(service.completePendingAuthFor('nope', 'user-1')).rejects.toThrow(/not found/);
  });
});

describe('rejectPendingAuth', () => {
  test('drops the request so the waiting device stops polling', async () => {
    const { service, pending } = makeService({
      pending: [
        {
          id: 'req-1',
          userId: 'user-1',
          status: PendingAuthStatus.PENDING,
          sessionToken: null,
          expiresAt: inHours(1),
        },
      ],
    });

    await service.rejectPendingAuth('req-1', 'user-1');

    expect(pending).toHaveLength(0);
  });

  test('refuses to drop another account\'s request', async () => {
    const { service, pending } = makeService({
      pending: [
        {
          id: 'req-1',
          userId: 'user-1',
          status: PendingAuthStatus.PENDING,
          sessionToken: null,
          expiresAt: inHours(1),
        },
      ],
    });

    await expect(service.rejectPendingAuth('req-1', 'someone-else')).rejects.toThrow(
      /different account/,
    );
    expect(pending).toHaveLength(1);
  });
});

describe('generateSessionToken', () => {
  test('tags the token as a session so email links cannot stand in for one', async () => {
    const { service } = makeService();

    expect(await service.generateSessionToken('user-1')).toBe(
      tokenFor({ sub: 'user-1', typ: 'session' }),
    );
  });
});
