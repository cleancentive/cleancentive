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
