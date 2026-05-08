import { describe, expect, test } from 'bun:test';

import {
  IntegrationQueueService,
  IntegrationWorkerService,
  OUTLINE_BOOTSTRAP_JOB,
  OUTLINE_RECONCILE_JOB,
  OUTLINE_SYNC_EVENT_JOB,
} from './integration-queue.service';

describe('IntegrationQueueService', () => {
  test('enqueues outline bootstrap as a retryable integration job', async () => {
    const added: Array<{ name: string; data: unknown; options: unknown }> = [];
    const queue = {
      add: async (name: string, data: unknown, options: unknown) => {
        added.push({ name, data, options });
      },
    };

    const service = new IntegrationQueueService(queue as any);

    await service.enqueueOutlineBootstrap({ userId: 'user-1' });

    expect(added).toHaveLength(1);
    expect(added[0].name).toBe(OUTLINE_BOOTSTRAP_JOB);
    expect(added[0].data).toEqual({ userId: 'user-1' });
    expect(added[0].options).toMatchObject({ attempts: 6, removeOnComplete: true, removeOnFail: false });
  });

  test('schedules outline reconciliation through the same durable queue', async () => {
    const added: Array<{ name: string; data: unknown; options: any }> = [];
    const queue = {
      add: async (name: string, data: unknown, options: unknown) => {
        added.push({ name, data, options });
      },
    };

    const service = new IntegrationQueueService(queue as any);

    await service.scheduleOutlineReconciliation();

    expect(added[0].name).toBe(OUTLINE_RECONCILE_JOB);
    expect(added[0].options.repeat).toEqual({ pattern: '30 3 * * *' });
  });

  test('enqueues Outline sync events with the source event name and payload', async () => {
    const added: Array<{ name: string; data: unknown }> = [];
    const queue = {
      add: async (name: string, data: unknown) => {
        added.push({ name, data });
      },
    };
    const service = new IntegrationQueueService(queue as any);

    await service.enqueueOutlineSyncEvent('team.created', { teamId: 'team-1', teamName: 'River Crew' });

    expect(added).toEqual([{
      name: OUTLINE_SYNC_EVENT_JOB,
      data: { eventName: 'team.created', payload: { teamId: 'team-1', teamName: 'River Crew' } },
    }]);
  });

  // Each EventEmitter listener method below is the bridge between an
  // @OnEvent('…') decorator and the BullMQ queue. The decorators themselves
  // are wired by NestJS at runtime, but verifying that each method enqueues
  // with the right event name and payload catches regressions where a payload
  // shape change or a copy-paste rename silently breaks one event flow.
  // (The avatar regression that motivated this test was exactly that: events
  // emitted but never reaching OutlineSyncService.)
  const eventChainCases: Array<{
    name: string;
    invoke: (svc: IntegrationQueueService, p: unknown) => Promise<void>;
    expectedEvent: string;
  }> = [
    { name: 'user.profile-changed', invoke: (s, p) => s.handleUserProfileChanged(p), expectedEvent: 'user.profile-changed' },
    { name: 'user.avatar-changed', invoke: (s, p) => s.handleUserAvatarChanged(p), expectedEvent: 'user.avatar-changed' },
    { name: 'admin.promoted', invoke: (s, p) => s.handleAdminPromoted(p), expectedEvent: 'admin.promoted' },
    { name: 'admin.demoted', invoke: (s, p) => s.handleAdminDemoted(p), expectedEvent: 'admin.demoted' },
    { name: 'team.member-joined', invoke: (s, p) => s.handleTeamMemberJoined(p), expectedEvent: 'team.member-joined' },
    { name: 'team.member-left', invoke: (s, p) => s.handleTeamMemberLeft(p), expectedEvent: 'team.member-left' },
    { name: 'team.created', invoke: (s, p) => s.handleTeamCreated(p), expectedEvent: 'team.created' },
    { name: 'team.renamed', invoke: (s, p) => s.handleTeamRenamed(p), expectedEvent: 'team.renamed' },
    { name: 'team.archived', invoke: (s, p) => s.handleTeamArchived(p), expectedEvent: 'team.archived' },
    { name: 'user.anonymized', invoke: (s, p) => s.handleUserAnonymized(p), expectedEvent: 'user.anonymized' },
    { name: 'user.deleted', invoke: (s, p) => s.handleUserDeleted(p), expectedEvent: 'user.deleted' },
  ];

  for (const eventCase of eventChainCases) {
    test(`event listener for ${eventCase.name} enqueues OUTLINE_SYNC_EVENT_JOB`, async () => {
      const added: Array<{ name: string; data: unknown }> = [];
      const queue = {
        add: async (name: string, data: unknown) => {
          added.push({ name, data });
        },
      };
      const service = new IntegrationQueueService(queue as any);
      const payload = { marker: 'probe' };

      await eventCase.invoke(service, payload);

      expect(added).toEqual([{
        name: OUTLINE_SYNC_EVENT_JOB,
        data: { eventName: eventCase.expectedEvent, payload },
      }]);
    });
  }
});

describe('IntegrationWorkerService', () => {
  test('dispatches outline bootstrap and reconciliation jobs', async () => {
    const calls: string[] = [];
    const outlineSync = {
      bootstrap: async () => calls.push('bootstrap'),
      reconcileTeamCollections: async () => calls.push('reconcile'),
      processEvent: async (eventName: string) => calls.push(eventName),
    };
    const service = new IntegrationWorkerService(outlineSync as any, null as any);

    await service.process({ name: OUTLINE_BOOTSTRAP_JOB } as any);
    await service.process({ name: OUTLINE_RECONCILE_JOB } as any);
    await service.process({ name: OUTLINE_SYNC_EVENT_JOB, data: { eventName: 'team.created', payload: {} } } as any);

    expect(calls).toEqual(['bootstrap', 'reconcile', 'team.created']);
  });
});
