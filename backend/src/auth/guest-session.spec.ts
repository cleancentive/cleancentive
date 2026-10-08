import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { UserService } from '../user/user.service';

/**
 * A guest id used to be whatever the browser said it was, sent as a plain
 * parameter. User ids are public — they sit on spot pages and team member
 * lists — so passing someone else's was enough to read, edit and delete their
 * picks. These cover the replacement: a signed guest session.
 */

interface Row {
  id: string;
  nickname: string;
  emails: Array<{ email: string }>;
  guest_token_issued_at?: Date | null;
}

function makeUserService(rows: Row[]) {
  const service: any = Object.create(UserService.prototype);
  service.userRepository = {
    findOne: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    update: async ({ id }: any, patch: any) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
  };
  return service as UserService;
}

function makeAuthService(userService: UserService) {
  const service: any = Object.create(AuthService.prototype);
  service.userService = userService;
  service.jwtService = {
    sign: (payload: Record<string, unknown>, opts?: Record<string, unknown>) =>
      JSON.stringify({ payload, opts }),
  };
  return service as AuthService;
}

describe('issueGuestToken', () => {
  test('honours an id already in localStorage so existing guests keep their picks', async () => {
    const rows: Row[] = [{ id: '0199b3d2-1c00-7000-8000-000000000001', nickname: 'guest', emails: [] }];
    const service = makeAuthService(makeUserService(rows));

    const result = await service.issueGuestToken('0199b3d2-1c00-7000-8000-000000000001');

    expect(result.userId).toBe('0199b3d2-1c00-7000-8000-000000000001');
    expect(result.token).toContain('"typ":"guest"');
    expect(rows[0].guest_token_issued_at).toBeInstanceOf(Date);
  });

  test('refuses an id that belongs to a real account', async () => {
    const rows: Row[] = [
      { id: '0199b3d2-1c00-7000-8000-000000000002', nickname: 'Real Person', emails: [{ email: 'a@b.c' }] },
    ];
    const service = makeAuthService(makeUserService(rows));

    const result = await service.issueGuestToken('0199b3d2-1c00-7000-8000-000000000002');

    expect(result.userId).not.toBe('0199b3d2-1c00-7000-8000-000000000002');
  });

  test('refuses an id whose token was handed out long ago', async () => {
    const rows: Row[] = [
      {
        id: '0199b3d2-1c00-7000-8000-000000000003',
        nickname: 'guest',
        emails: [],
        guest_token_issued_at: new Date(Date.now() - 60 * 60 * 1000),
      },
    ];
    const service = makeAuthService(makeUserService(rows));

    const result = await service.issueGuestToken('0199b3d2-1c00-7000-8000-000000000003');

    expect(result.userId).not.toBe('0199b3d2-1c00-7000-8000-000000000003');
  });

  test('refuses an id claimed moments ago, not just long ago', async () => {
    // A guest's id is public as soon as they log a pick, and the row is stamped
    // at that same moment. A window of even a minute is one an attacker
    // watching the public feed can hit.
    const rows: Row[] = [
      {
        id: '0199b3d2-1c00-7000-8000-000000000004',
        nickname: 'guest',
        emails: [],
        guest_token_issued_at: new Date(Date.now() - 2000),
      },
    ];
    const service = makeAuthService(makeUserService(rows));

    const result = await service.issueGuestToken('0199b3d2-1c00-7000-8000-000000000004');

    expect(result.userId).not.toBe('0199b3d2-1c00-7000-8000-000000000004');
  });

  test('refuses an id that is already in use, even with no token recorded', async () => {
    // A guest's id becomes visible the moment they log a pick — it is on the
    // spot. Rows are created lazily, so the row that appears then is the only
    // record that the id is taken.
    const rows: Row[] = [
      {
        id: '0199b3d2-1c00-7000-8000-000000000005',
        nickname: 'guest',
        emails: [],
        guest_token_issued_at: new Date(Date.now() - 60 * 60 * 1000),
      },
    ];
    const service = makeAuthService(makeUserService(rows));

    const result = await service.issueGuestToken('0199b3d2-1c00-7000-8000-000000000005');

    expect(result.userId).not.toBe('0199b3d2-1c00-7000-8000-000000000005');
  });

  test('ignores anything that is not a uuid', async () => {
    const service = makeAuthService(makeUserService([]));

    const result = await service.issueGuestToken('../../etc/passwd');

    expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('mints a fresh identity when the visitor has none', async () => {
    const service = makeAuthService(makeUserService([]));

    const first = await service.issueGuestToken();
    const second = await service.issueGuestToken();

    expect(first.userId).not.toBe(second.userId);
  });
});

describe('JwtStrategy', () => {
  function strategyFor(rows: Row[]): JwtStrategy {
    const strategy: any = Object.create(JwtStrategy.prototype);
    strategy.userService = makeUserService(rows);
    return strategy as JwtStrategy;
  }

  test('marks a guest token as a guest', async () => {
    const strategy = strategyFor([{ id: 'g1', nickname: 'guest', emails: [] }]);

    expect(await strategy.validate({ sub: 'g1', typ: 'guest' })).toEqual({
      userId: 'g1',
      isGuest: true,
      authKind: 'session',
    });
  });

  test('stops honouring a guest token once that id becomes an account', async () => {
    const strategy = strategyFor([{ id: 'g1', nickname: 'Claimed', emails: [{ email: 'a@b.c' }] }]);

    await expect(strategy.validate({ sub: 'g1', typ: 'guest' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  test('accepts an account session without touching the database', async () => {
    const strategy = strategyFor([]);

    expect(await strategy.validate({ sub: 'u1', typ: 'session' })).toEqual({
      userId: 'u1',
      isGuest: false,
      authKind: 'session',
    });
  });

  test('rejects a magic link presented as a bearer token', async () => {
    const strategy = strategyFor([]);

    await expect(
      strategy.validate({ sub: 'u1', email: 'a@b.c', purpose: 'magic-link' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
