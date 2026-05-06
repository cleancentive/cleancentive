import { BadRequestException } from '@nestjs/common';
import { describe, expect, test } from 'bun:test';

import { OutlineSyncService } from './outline-sync.service';

describe('OutlineSyncService maintenance', () => {
  test('rejects wipe requests without the exact confirmation before touching Outline', async () => {
    const { service, pgQueries } = createOutlineSyncHarness();

    await expect(service.wipeOutlineContentOnce('wrong')).rejects.toThrow(BadRequestException);

    expect(pgQueries).toEqual([]);
  });

  test('rejects repeated wipe and initialization after maintenance state is recorded', async () => {
    const { service } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      maintenanceStates: ['outline-content-wiped', 'outline-content-initialized'],
    });

    await expect(service.wipeOutlineContentOnce('WIPE_OUTLINE_CONTENT')).rejects.toThrow(BadRequestException);
    await expect(service.initializeOutlineContentOnce()).rejects.toThrow(BadRequestException);
  });

  test('wipes Outline content rows and clears Cleancentive collection mappings in a transaction', async () => {
    const { service, pgQueries, teamCollectionRepository } = createOutlineSyncHarness({
      mappings: [{ team_id: 'team-1', outline_collection_id: 'collection-1' }],
      pgCounts: {
        shares: 2,
        documents: 3,
        collections: 4,
        groups: 5,
      },
    });

    const summary = await service.wipeOutlineContentOnce('WIPE_OUTLINE_CONTENT');

    expect(pgQueries[0].sql).toBe('BEGIN');
    expect(pgQueries.at(-1)?.sql).toBe('COMMIT');
    expect(pgQueries.some((query) => query.sql.includes('DELETE FROM shares'))).toBe(true);
    expect(pgQueries.some((query) => query.sql.includes('DELETE FROM documents'))).toBe(true);
    expect(pgQueries.some((query) => query.sql.includes('DELETE FROM collections'))).toBe(true);
    expect(pgQueries.some((query) => query.sql.includes('DELETE FROM groups') && query.params?.[0]?.includes('stewards'))).toBe(true);
    expect(pgQueries.some((query) => query.sql.includes('DELETE FROM groups') && query.sql.includes('"teamId" = $2'))).toBe(true);
    expect(pgQueries.some((query) => query.sql.includes('DELETE FROM group_memberships') && query.sql.includes('groupId'))).toBe(true);
    expect(pgQueries.some((query) => query.sql.includes('DELETE FROM team_outline_collections'))).toBe(true);
    expect(teamCollectionRepository.clearCalls).toBe(1);
    expect(summary).toMatchObject({
      confirmation: 'WIPE_OUTLINE_CONTENT',
      outline: {
        shares: 2,
        documents: 3,
        collections: 4,
        groups: 5,
      },
      cleancentive: { teamOutlineCollections: 1 },
    });
  });

  test('wipes Cleancentive groups for active team ids even when mappings are missing', async () => {
    const { service, pgQueries } = createOutlineSyncHarness({
      teams: [{ id: 'team-without-mapping', name: 'Unmapped Team', archived_at: null, system_key: null }],
    });

    await service.wipeOutlineContentOnce('WIPE_OUTLINE_CONTENT');

    const groupsDelete = pgQueries.find((query) => query.sql.includes('DELETE FROM groups'));
    expect(groupsDelete?.params?.[0]).toContain('team-without-mapping');
  });

  test('initializes stewards and active team collections without touching existing mappings', async () => {
    const { service, apiCalls, mappings, teamCollectionRepository } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [
        { id: 'team-existing', name: 'Existing Team', archived_at: null, system_key: null },
        { id: 'team-active', name: 'River Crew', archived_at: null, system_key: null },
        { id: 'team-archived', name: 'Archived Team', archived_at: new Date(), system_key: null },
        { id: 'team-stewards', name: 'Stewards', archived_at: null, system_key: 'stewards' },
      ],
      mappings: [
        { team_id: 'team-existing', outline_collection_id: 'existing-collection', outline_share_id: 'existing-share' },
      ],
      groupsByExternalId: {
        stewards: 'group-stewards',
        'team-active': 'group-team-active',
      },
    });

    const summary = await service.initializeOutlineContentOnce();

    expect(apiCalls.map((call) => call.endpoint)).toEqual([
      '/collections.create',
      '/documents.create',
      '/groups.update',
      '/collections.create',
      '/collections.add_group',
      '/documents.create',
      '/shares.create',
      '/collections.create',
      '/collections.add_group',
      '/documents.create',
      '/shares.create',
      '/collections.create',
      '/collections.add_group',
      '/documents.create',
    ]);
    expect(apiCalls.find((call) => call.body?.name === 'Existing Team')).toBeUndefined();
    expect(mappings).toContainEqual(expect.objectContaining({
      team_id: 'team-active',
      outline_collection_id: 'collection-2',
      outline_group_id: 'group-team-active',
      outline_share_id: 'share-1',
    }));
    expect(mappings).toContainEqual(expect.objectContaining({
      team_id: 'team-stewards',
      outline_collection_id: 'collection-3',
      outline_group_id: 'group-stewards',
      outline_share_id: 'share-2',
    }));
    expect(teamCollectionRepository.saveCalls).toBe(2);
    expect(summary).toMatchObject({
      gettingStarted: { created: true },
      teams: { created: 1, skipped: 1 },
      stewards: { publicCreated: true, confidentialCreated: true },
    });
  });

  test('repairs system collections that already exist by adding starter docs and group grants', async () => {
    const { service, apiCalls } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [{ id: 'team-stewards', name: 'Stewards', archived_at: null, system_key: 'stewards' }],
      groupsByExternalId: { stewards: 'group-stewards' },
      collectionsByName: {
        'Getting Started': 'collection-getting-started',
        'Stewards Confidential': 'collection-confidential',
      },
      mappings: [{ team_id: 'team-stewards', outline_collection_id: 'collection-stewards' }],
    });

    const summary = await service.initializeOutlineContentOnce();

    expect(apiCalls.some((call) => call.endpoint === '/collections.create' && call.body?.name === 'Getting Started')).toBe(false);
    expect(apiCalls).toContainEqual({
      endpoint: '/documents.create',
      body: expect.objectContaining({ collectionId: 'collection-getting-started' }),
    });
    expect(apiCalls).toContainEqual({
      endpoint: '/collections.add_group',
      body: { id: 'collection-confidential', groupId: 'group-stewards', permission: 'admin' },
    });
    expect(apiCalls).toContainEqual({
      endpoint: '/documents.create',
      body: expect.objectContaining({ collectionId: 'collection-confidential' }),
    });
    expect(summary.gettingStarted.created).toBe(false);
    expect(summary.stewards.confidentialCreated).toBe(false);
  });

  test('saves team mapping before creating share so retries skip partial initialization', async () => {
    const { service, teamCollectionRepository } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [{ id: 'team-active', name: 'River Crew', archived_at: null, system_key: null }],
      groupsByExternalId: { 'team-active': 'group-team-active' },
      failShares: true,
    });

    await expect(service.initializeOutlineContentOnce()).rejects.toThrow('share failed');

    expect(teamCollectionRepository.saveCalls).toBe(1);
  });

  test('manual initialization saves team mapping before starter doc creation', async () => {
    const { service, teamCollectionRepository } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [{ id: 'team-active', name: 'River Crew', archived_at: null, system_key: null }],
      groupsByExternalId: { 'team-active': 'group-team-active' },
      collectionsByName: {
        'Getting Started': 'collection-getting-started',
        'Stewards Confidential': 'collection-confidential',
      },
      mappings: [{ team_id: 'team-stewards', outline_collection_id: 'collection-stewards', outline_share_id: 'share-stewards' }],
      failDocumentsForCollection: 'collection-1',
    });

    await expect(service.initializeOutlineContentOnce()).rejects.toThrow('document failed');

    expect(teamCollectionRepository.saveCalls).toBe(1);
  });

  test('manual initialization retries missing initial share for initializer-owned partial mappings', async () => {
    const { service, apiCalls, mappings, teamCollectionRepository } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [{ id: 'team-active', name: 'River Crew', archived_at: null, system_key: null }],
      mappings: [{
        id: 'mapping-1',
        team_id: 'team-active',
        outline_collection_id: 'collection-existing',
        outline_group_id: 'group-team-active',
        outline_share_id: null,
        initialized_at: new Date(),
      }],
    });

    const summary = await service.initializeOutlineContentOnce();

    expect(apiCalls).toContainEqual({
      endpoint: '/shares.create',
      body: { collectionId: 'collection-existing', published: true },
    });
    expect(mappings[0].outline_share_id).toBe('share-1');
    expect(teamCollectionRepository.updateCalls).toBe(1);
    expect(summary.teams).toEqual({ created: 0, skipped: 1 });
  });

  test('manual initialization does not publish legacy mappings with null initialized_at', async () => {
    const { service, apiCalls, mappings } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [{ id: 'team-active', name: 'River Crew', archived_at: null, system_key: null }],
      mappings: [{
        id: 'mapping-legacy',
        team_id: 'team-active',
        outline_collection_id: 'collection-existing',
        outline_share_id: null,
        initialized_at: null,
      }],
    });

    await service.initializeOutlineContentOnce();

    expect(apiCalls.some((call) => call.endpoint === '/shares.create' && call.body?.collectionId === 'collection-existing')).toBe(false);
    expect(mappings[0].outline_share_id).toBeNull();
  });

  test('provisions new team collections with read access, team write access, starter doc, and public share', async () => {
    const { service, apiCalls, mappings } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      groupsByExternalId: { 'team-active': 'group-team-active' },
    });

    await service.handleTeamCreated({ teamId: 'team-active', teamName: 'River Crew' });

    expect(apiCalls).toEqual([
      {
        endpoint: '/groups.update',
        body: { id: 'group-team-active', name: 'Team: River Crew' },
      },
      {
        endpoint: '/collections.create',
        body: { name: 'River Crew', permission: 'read' },
      },
      {
        endpoint: '/collections.add_group',
        body: { id: 'collection-1', groupId: 'group-team-active', permission: 'read_write' },
      },
      {
        endpoint: '/documents.create',
        body: expect.objectContaining({ collectionId: 'collection-1', title: 'Welcome to the River Crew wiki', publish: true }),
      },
      {
        endpoint: '/shares.create',
        body: { collectionId: 'collection-1', published: true },
      },
    ]);
    expect(mappings).toContainEqual(expect.objectContaining({
      team_id: 'team-active',
      outline_collection_id: 'collection-1',
      outline_group_id: 'group-team-active',
      outline_share_id: 'share-1',
    }));
  });

  test('does not touch existing collection permissions names or shares when team-created mapping already exists', async () => {
    const { service, apiCalls, mappings } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      mappings: [{
        id: 'mapping-1',
        team_id: 'team-active',
        outline_collection_id: 'collection-existing',
        outline_group_id: 'group-team-active',
        outline_share_id: null,
        initialized_at: new Date(),
      }],
    });

    await service.handleTeamCreated({ teamId: 'team-active', teamName: 'Renamed Crew' });

    expect(apiCalls).toEqual([]);
    expect(mappings[0].outline_share_id).toBeNull();
  });

  test('joining a team only adds existing group membership', async () => {
    const { service, apiCalls } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      usersByEmail: { 'user@example.com': 'outline-user-1' },
      emailsByUserId: { 'user-1': 'user@example.com' },
      groupsByExternalId: { 'team-active': 'group-team-active' },
    });

    await service.handleTeamMemberJoined({ teamId: 'team-active', userId: 'user-1', teamName: 'River Crew' });

    expect(apiCalls).toEqual([{
      endpoint: '/groups.add_user',
      body: { id: 'group-team-active', userId: 'outline-user-1' },
    }]);
  });

  test('backfill and reconciliation skip system teams', async () => {
    const { service, apiCalls } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [{ id: 'team-stewards', name: 'Stewards', archived_at: null, system_key: 'stewards' }],
    });

    await service.bootstrap();
    await service.reconcileTeamCollections();

    expect(apiCalls.some((call) => call.endpoint === '/collections.create' && call.body?.name === 'Stewards')).toBe(false);
  });

  test('bootstrap does not recreate missing shares for existing mappings', async () => {
    const { service, apiCalls } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [{ id: 'team-existing', name: 'Existing Team', archived_at: null, system_key: null }],
      mappings: [{ team_id: 'team-existing', outline_collection_id: 'collection-existing', outline_share_id: null }],
    });

    await service.bootstrap();

    expect(apiCalls.some((call) => call.endpoint === '/shares.create')).toBe(false);
  });

  test('renaming a team updates the Outline group but not the existing collection', async () => {
    const { service, apiCalls } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      mappings: [{ team_id: 'team-active', outline_collection_id: 'collection-existing' }],
      groupsByExternalId: { 'team-active': 'group-team-active' },
    });

    await service.handleTeamRenamed({ teamId: 'team-active', oldName: 'River Crew', newName: 'Harbor Crew' });

    expect(apiCalls).toEqual([{
      endpoint: '/groups.update',
      body: { id: 'group-team-active', name: 'Team: Harbor Crew' },
    }]);
    expect(apiCalls.some((call) => call.endpoint === '/collections.update')).toBe(false);
  });

  test('archiving a team removes group users without removing collection group permissions', async () => {
    const { service, apiCalls } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      mappings: [{ team_id: 'team-active', outline_collection_id: 'collection-existing' }],
      groupsByExternalId: { 'team-active': 'group-team-active' },
      groupMemberships: { 'group-team-active': ['outline-user-1', 'outline-user-2'] },
    });

    await service.handleTeamArchived({ teamId: 'team-active', teamName: 'River Crew' });

    expect(apiCalls).toEqual([
      { endpoint: '/groups.memberships', body: { id: 'group-team-active', limit: 100 } },
      { endpoint: '/groups.remove_user', body: { id: 'group-team-active', userId: 'outline-user-1' } },
      { endpoint: '/groups.remove_user', body: { id: 'group-team-active', userId: 'outline-user-2' } },
    ]);
    expect(apiCalls.some((call) => call.endpoint === '/collections.remove_group')).toBe(false);
  });

  test('reconciliation initializes unmapped active teams and never mutates mapped collection names, permissions, or shares', async () => {
    const { service, apiCalls } = createOutlineSyncHarness({
      ready: true,
      apiKey: 'ol_api_test',
      teams: [
        { id: 'team-existing', name: 'Existing Team', archived_at: null, system_key: null },
        { id: 'team-new', name: 'New Team', archived_at: null, system_key: null },
        { id: 'team-archived', name: 'Archived Team', archived_at: new Date(), system_key: null },
      ],
      mappings: [
        { team_id: 'team-existing', outline_collection_id: 'collection-existing', outline_share_id: null },
        { team_id: 'team-archived', outline_collection_id: 'collection-archived', outline_share_id: null },
      ],
      groupsByExternalId: {
        'team-existing': 'group-team-existing',
        'team-new': 'group-team-new',
        'team-archived': 'group-team-archived',
      },
      collectionInfoById: {
        'collection-existing': { id: 'collection-existing', name: 'Remote Custom Name' },
      },
    });

    await service.reconcileTeamCollections();

    expect(apiCalls.some((call) => call.endpoint === '/collections.update')).toBe(false);
    expect(apiCalls.some((call) => call.endpoint === '/collections.remove_group')).toBe(false);
    expect(apiCalls.some((call) => call.endpoint === '/shares.create' && call.body?.collectionId === 'collection-existing')).toBe(false);
    expect(apiCalls.some((call) => call.endpoint === '/shares.create' && call.body?.collectionId === 'collection-archived')).toBe(false);
    expect(apiCalls).toContainEqual({
      endpoint: '/collections.create',
      body: { name: 'New Team', permission: 'read' },
    });
    expect(apiCalls).toContainEqual({
      endpoint: '/collections.add_group',
      body: { id: 'collection-1', groupId: 'group-team-new', permission: 'read_write' },
    });
  });
});

function createOutlineSyncHarness(options: {
  ready?: boolean;
  apiKey?: string;
  teams?: any[];
  mappings?: any[];
  groupsByExternalId?: Record<string, string>;
  collectionsByName?: Record<string, string>;
  collectionInfoById?: Record<string, any>;
  groupMemberships?: Record<string, string[]>;
  emailsByUserId?: Record<string, string>;
  usersByEmail?: Record<string, string>;
  failShares?: boolean;
  failDocuments?: boolean;
  failDocumentsForCollection?: string;
  pgCounts?: Record<string, number>;
  maintenanceStates?: string[];
} = {}) {
  const pgQueries: Array<{ sql: string; params?: any[] }> = [];
  const pgCounts = options.pgCounts ?? {};
  const mappings = options.mappings ?? [];
  const apiCalls: Array<{ endpoint: string; body?: any }> = [];
  let createdCollections = 0;
  let createdShares = 0;
  const groupsByExternalId = { ...(options.groupsByExternalId ?? {}) };
  const collectionsByName = { ...(options.collectionsByName ?? {}) };
  const emailsByUserId = options.emailsByUserId ?? {};
  const usersByEmail = options.usersByEmail ?? {};

  const service = new OutlineSyncService(
    { findById: async () => null } as any,
    { getAdminUserIds: async () => [] } as any,
    createRepository(options.teams ?? []) as any,
    createTeamCollectionRepository(mappings) as any,
    createRepository([]) as any,
    createRepository((options.maintenanceStates ?? []).map((key) => ({ key, completed_at: new Date() }))) as any,
  ) as any;

  service.pg = {
    query: async (sql: string, params?: any[]) => {
      pgQueries.push({ sql, params });
      if (sql.includes('to_regclass')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('SELECT id FROM groups')) {
        return { rows: groupsByExternalId[params?.[0]] ? [{ id: groupsByExternalId[params?.[0]] }] : [] };
      }
      if (sql.includes('SELECT id FROM users')) {
        return { rows: usersByEmail[params?.[0]] ? [{ id: usersByEmail[params?.[0]] }] : [] };
      }
      if (sql.includes('SELECT id FROM collections')) {
        return { rows: collectionsByName[params?.[0]] ? [{ id: collectionsByName[params?.[0]] }] : [] };
      }
      const countKey = Object.keys(pgCounts).find((key) => sql.includes(` AS "${key}"`));
      if (countKey) return { rows: [{ [countKey]: pgCounts[countKey] }] };
      return { rows: [] };
    },
  };
  service.outlineTeamId = options.ready ? 'outline-team' : null;
  service.outlineAdminUserId = options.ready ? 'outline-admin' : null;
  service.outlineApiKey = options.apiKey ?? '';
  service.ensureStewardsGroup = async () => undefined;
  service.syncExistingAdmins = async () => undefined;
  service.ensureWikiBucket = async () => undefined;
  service.cacheOutlineTeamAndAdmin = async () => undefined;
  service.provisionWorkspaceBrandingAndAnalytics = async () => undefined;
  service.provisionApiKey = async () => undefined;
  service.provisionWebhookSubscription = async () => undefined;
  service.getEmail = async (userId: string) => emailsByUserId[userId] ?? null;
  service.ensureTeamGroup = async (teamId: string, teamName: string) => {
    if (groupsByExternalId[teamId]) {
      apiCalls.push({ endpoint: '/groups.update', body: { id: groupsByExternalId[teamId], name: `Team: ${teamName}` } });
      return;
    }
    groupsByExternalId[teamId] = `group-${teamId}`;
    apiCalls.push({ endpoint: '/groups.create', body: { name: `Team: ${teamName}`, externalId: teamId } });
  };
  service.callOutlineApi = async (endpoint: string, body?: any) => {
    apiCalls.push({ endpoint, body });
    if (endpoint === '/collections.create') return { data: { id: `collection-${++createdCollections}` } };
    if (endpoint === '/collections.info') return { data: options.collectionInfoById?.[body?.id] ?? null };
    if (
      endpoint === '/documents.create' &&
      (options.failDocuments || options.failDocumentsForCollection === body?.collectionId)
    ) throw new Error('document failed');
    if (endpoint === '/groups.memberships') {
      return { data: { users: (options.groupMemberships?.[body?.id] ?? []).map((id) => ({ id })) } };
    }
    if (endpoint === '/shares.create') {
      if (options.failShares) throw new Error('share failed');
      return { data: { id: `share-${++createdShares}` } };
    }
    return { data: { id: 'ok' } };
  };

  return {
    service: service as OutlineSyncService,
    pgQueries,
    apiCalls,
    mappings,
    teamCollectionRepository: service.teamCollectionRepository,
  };
}

function createTeamCollectionRepository(records: any[]) {
  const repository = {
    clearCalls: 0,
    saveCalls: 0,
    updateCalls: 0,
    create: (record: any) => ({ id: record.id ?? `${records.length + 1}`, ...record }),
    findOne: async ({ where }: any) => records.find((record) => matchesWhere(record, where)) ?? null,
    save: async function (record: any) {
      this.saveCalls++;
      const existing = records.find((candidate) => candidate.id === record.id);
      if (existing) {
        Object.assign(existing, record);
      } else {
        records.push(record);
      }
      return record;
    },
    clear: async function () {
      this.clearCalls++;
      const count = records.length;
      records.splice(0, records.length);
      return { affected: count };
    },
    count: async () => records.length,
    find: async () => records,
    update: async (where: any, patch: any) => {
      repository.updateCalls++;
      const record = records.find((candidate) => matchesWhere(candidate, where));
      if (record) Object.assign(record, patch);
    },
  };
  return repository;
}

function createRepository(records: any[]) {
  return {
    create: (record: any) => ({ id: record.id ?? `${records.length + 1}`, ...record }),
    save: async (record: any) => {
      const existing = records.find((candidate) => candidate.id === record.id);
      if (existing) Object.assign(existing, record);
      else records.push(record);
      return record;
    },
    find: async ({ where }: any = {}) => records.filter((record) => !where || matchesWhere(record, where)),
    findOne: async ({ where }: any) => records.find((record) => matchesWhere(record, where)) ?? null,
  };
}

function matchesWhere(record: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '_type' in value) {
      if (value._type === 'isNull') return record[key] === null;
      if (value._type === 'not') return record[key] !== null;
    }
    return record[key] === value;
  });
}
