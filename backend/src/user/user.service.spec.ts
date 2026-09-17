import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';

import { UserService } from './user.service';

interface ActiveCleanupRow {
  cleanup_name: string;
  start_at: Date;
  end_at: Date;
  location_name: string | null;
}

function makeService(opts: {
  activeCleanupDateId: string | null;
  cleanupRow?: ActiveCleanupRow | null;
}) {
  const updates: any[] = [];

  const userRepository = {
    findOne: async () => ({
      id: 'u1',
      nickname: 'tester',
      active_team_id: null,
      active_cleanup_date_id: opts.activeCleanupDateId,
      emails: [],
    }),
    query: async (sql: string) => {
      if (sql.includes('FROM cleanup_dates')) {
        return opts.cleanupRow ? [opts.cleanupRow] : [];
      }
      return [];
    },
    update: async (where: any, patch: any) => {
      updates.push({ where, patch });
    },
  };

  // Use the prototype method directly so we don't have to instantiate every repo.
  const service: any = Object.create(UserService.prototype);
  service.userRepository = userRepository;

  return { service, updates };
}

function inHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function row(start: Date, end: Date): ActiveCleanupRow {
  return {
    cleanup_name: 'River Walk',
    start_at: start,
    end_at: end,
    location_name: 'Solothurn',
  };
}

describe('UserService.getProfileWithContext active cleanup expiry', () => {
  test('clears an active cleanup date whose end has passed', async () => {
    const { service, updates } = makeService({
      activeCleanupDateId: 'cd1',
      cleanupRow: row(inHours(-5), inHours(-2)),
    });

    const result = await service.getProfileWithContext('u1');

    expect(result.active_cleanup_date_id).toBeNull();
    expect(result.active_cleanup_name).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: 'u1' });
    expect(updates[0].patch.active_cleanup_date_id).toBeNull();
  });

  test('clears an active cleanup date whose row no longer exists', async () => {
    const { service, updates } = makeService({
      activeCleanupDateId: 'cd1',
      cleanupRow: null,
    });

    const result = await service.getProfileWithContext('u1');

    expect(result.active_cleanup_date_id).toBeNull();
    expect(updates).toHaveLength(1);
  });

  test('keeps an ongoing cleanup date and resolves its context', async () => {
    const { service, updates } = makeService({
      activeCleanupDateId: 'cd1',
      cleanupRow: row(inHours(-1), inHours(2)),
    });

    const result = await service.getProfileWithContext('u1');

    expect(result.active_cleanup_date_id).toBe('cd1');
    expect(result.active_cleanup_name).toBe('River Walk');
    expect(result.active_cleanup_location).toBe('Solothurn');
    expect(updates).toHaveLength(0);
  });

  test('keeps a date that has not started yet — creating a cleanup activates its future date', async () => {
    const { service, updates } = makeService({
      activeCleanupDateId: 'cd1',
      cleanupRow: row(inHours(48), inHours(51)),
    });

    const result = await service.getProfileWithContext('u1');

    expect(result.active_cleanup_date_id).toBe('cd1');
    expect(result.active_cleanup_name).toBe('River Walk');
    expect(updates).toHaveLength(0);
  });

  test('writes nothing when no cleanup date is active', async () => {
    const { service, updates } = makeService({ activeCleanupDateId: null });

    const result = await service.getProfileWithContext('u1');

    expect(result.active_cleanup_date_id).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
