import { BadRequestException } from '@nestjs/common';
import { describe, expect, test } from 'bun:test';

import { TeamService } from './team.service';

describe('TeamService system-managed Stewards team', () => {
  test('rejects manual joins and leaves for Stewards team', async () => {
    const { service } = createTeamServiceHarness({
      teams: [createTeam({ id: 'team-stewards', system_key: 'stewards' })],
      registeredUserIds: ['user-1'],
    });

    await expect(service.joinTeam('team-stewards', 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.leaveTeam('team-stewards', 'user-1')).rejects.toThrow(BadRequestException);
  });

  test('returns steward admins as organizer members in Stewards team detail', async () => {
    const { service, memberships } = createTeamServiceHarness({
      teams: [createTeam({ id: 'team-stewards', system_key: 'stewards' })],
      users: [
        { id: 'admin-1', nickname: 'Avery', avatar_email_id: 'email-1' },
        { id: 'admin-2', nickname: 'Blake', avatar_email_id: null },
      ],
      adminUserIds: ['admin-1', 'admin-2'],
    });

    const detail = await service.getTeamDetail('team-stewards', 'admin-1', false);

    expect(detail).toMatchObject({
      isSystem: true,
      systemKey: 'stewards',
      membershipManagedBy: 'steward-role',
      userRole: 'organizer',
    });
    expect(detail.members).toEqual([
      { userId: 'admin-1', nickname: 'Avery', role: 'organizer', avatarEmailId: 'email-1' },
      { userId: 'admin-2', nickname: 'Blake', role: 'organizer', avatarEmailId: null },
    ]);
    expect(memberships).toMatchObject([
      { team_id: 'team-stewards', user_id: 'admin-1', role: 'organizer' },
      { team_id: 'team-stewards', user_id: 'admin-2', role: 'organizer' },
    ]);
  });

  test('includes Stewards in member-only search after reconciling admin membership', async () => {
    const { service } = createTeamServiceHarness({
      teams: [createTeam({ id: 'team-stewards', system_key: 'stewards' })],
      users: [{ id: 'admin-1', nickname: 'Avery', avatar_email_id: null }],
      adminUserIds: ['admin-1'],
    });

    const teams = await service.searchTeams({
      memberOnly: true,
      currentUserIsPlatformAdmin: true,
      userId: 'admin-1',
    });

    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      userRole: 'organizer',
      isSystem: true,
      systemKey: 'stewards',
      membershipManagedBy: 'steward-role',
    });
  });

  test('rejects email pattern management for Stewards team', async () => {
    const { service } = createTeamServiceHarness({
      teams: [createTeam({ id: 'team-stewards', system_key: 'stewards' })],
    });

    await expect(service.setEmailPatterns('team-stewards', ['example.com'])).rejects.toThrow(BadRequestException);
  });

  test('rejects custom CSS management for Stewards team', async () => {
    const { service } = createTeamServiceHarness({
      teams: [createTeam({ id: 'team-stewards', system_key: 'stewards' })],
    });

    await expect(service.updateCustomCss('team-stewards', '.x{}')).rejects.toThrow(BadRequestException);
  });
});

function createTeam(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-1',
    name: 'Stewards',
    name_normalized: 'stewards',
    description: 'Platform stewards',
    archived_at: null,
    archived_by: null,
    custom_css: null,
    system_key: null,
    ...overrides,
  };
}

function createTeamServiceHarness(options: {
  teams?: any[];
  memberships?: any[];
  users?: any[];
  registeredUserIds?: string[];
  adminUserIds?: string[];
} = {}) {
  const teams = options.teams ?? [];
  const memberships = options.memberships ?? [];
  const users = options.users ?? [];
  const registeredUserIds = options.registeredUserIds ?? users.map((user) => user.id);
  const adminUserIds = options.adminUserIds ?? [];

  const teamRepository = createRepository(teams);
  const teamMembershipRepository = createRepository(memberships);
  const teamMessageRepository = createRepository([]);
  const teamEmailPatternRepository = createRepository([]);
  const teamOutlineCollectionRepository = createRepository([]);
  const userRepository = createRepository(users);
  const userEmailRepository = {
    count: async ({ where }: any) => registeredUserIds.includes(where.user_id) ? 1 : 0,
    createQueryBuilder: () => ({
      leftJoinAndSelect: () => ({
        getMany: async () => [],
      }),
    }),
  };
  const adminService = {
    getAdminUserIds: async () => adminUserIds,
    isAdmin: async (userId: string) => adminUserIds.includes(userId),
  };
  const emailService = {};
  const eventEmitter = { emit: () => undefined };

  const service = new TeamService(
    teamRepository as any,
    teamMembershipRepository as any,
    teamMessageRepository as any,
    teamEmailPatternRepository as any,
    teamOutlineCollectionRepository as any,
    userRepository as any,
    userEmailRepository as any,
    adminService as any,
    emailService as any,
    eventEmitter as any,
  );

  return { service, memberships };
}

function createRepository(records: any[]) {
  return {
    create: (record: any) => ({ id: record.id ?? `${records.length + 1}`, ...record }),
    createQueryBuilder: () => ({
      orderBy: () => ({
        where: () => queryBuilderResult(records),
        andWhere: () => queryBuilderResult(records),
        getMany: async () => records,
      }),
      select: () => ({ where: () => ({ getRawMany: async () => [] }) }),
    }),
    save: async (record: any) => {
      const existingIndex = records.findIndex((candidate) => candidate.id === record.id);
      if (existingIndex >= 0) {
        records[existingIndex] = { ...records[existingIndex], ...record };
        return records[existingIndex];
      }
      records.push(record);
      return record;
    },
    findOne: async ({ where }: any) => records.find((record) => matchesWhere(record, where)) ?? null,
    find: async ({ where, order }: any = {}) => {
      const filtered = where ? records.filter((record) => matchesWhere(record, where)) : [...records];
      if (order?.created_at === 'ASC') {
        return filtered.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
      }
      return filtered;
    },
    count: async ({ where }: any = {}) => records.filter((record) => !where || matchesWhere(record, where)).length,
    delete: async (where: any) => {
      const keep = records.filter((record) => !matchesWhere(record, where));
      records.splice(0, records.length, ...keep);
    },
    update: async () => undefined,
  };
}

function queryBuilderResult(records: any[]) {
  return {
    andWhere: () => queryBuilderResult(records),
    getMany: async () => records,
  };
}

function matchesWhere(record: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '_value' in value) {
      return value._value.includes(record[key]);
    }
    return record[key] === value;
  });
}
