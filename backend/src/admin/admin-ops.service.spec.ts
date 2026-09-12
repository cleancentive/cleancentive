import { describe, expect, test } from 'bun:test';

import { AdminOpsService, getOverallHealthStatus, type OverallHealthSignals } from './admin-ops.service';

type AddedJob = { name: string; data: Record<string, unknown> }

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function makeRetryHarness(spots: Array<Record<string, unknown>>) {
  const added: AddedJob[] = [];
  const saved: Array<Record<string, unknown>> = [];

  const service = Object.create(AdminOpsService.prototype) as AdminOpsService;
  Object.assign(service as unknown as Record<string, unknown>, {
    stalledAfterMinutes: 30,
    spotRepository: {
      query: async () => spots.map((s) => ({ id: s.id })),
      findOne: async ({ where }: { where: { id: string } }) => spots.find((s) => s.id === where.id) ?? null,
      save: async (row: Record<string, unknown>) => { saved.push(row); return row },
    },
    detectionQueue: {
      getJob: async () => null,
      add: async (name: string, data: Record<string, unknown>) => { added.push({ name, data }); },
    },
  });

  return { service, added, saved };
}

describe('AdminOpsService.retryFailedSpots', () => {
  test('retries a plant spot as identify-plant, carrying subjectKind', async () => {
    // Regression: the retry hardcoded 'detect-litter' and dropped subjectKind, so
    // retrying a failed plant spot quietly ran litter detection over a plant photo.
    const { service, added } = makeRetryHarness([
      { id: 'plant-1', processing_status: 'failed', subject_kind: 'plant', user_id: 'u', image_key: 'k', mime_type: 'image/jpeg', updated_at: minutesAgo(1) },
    ]);

    const result = await service.retryFailedSpots(10);

    expect(result.retried).toBe(1);
    expect(added[0].name).toBe('identify-plant');
    expect(added[0].data.subjectKind).toBe('plant');
  });

  test('retries a litter spot as detect-litter', async () => {
    const { service, added } = makeRetryHarness([
      { id: 'litter-1', processing_status: 'failed', subject_kind: 'litter', user_id: 'u', image_key: 'k', mime_type: 'image/jpeg', updated_at: minutesAgo(1) },
    ]);

    await service.retryFailedSpots(10);

    expect(added[0].name).toBe('detect-litter');
    expect(added[0].data.subjectKind).toBe('litter');
  });

  test('rescues a spot stalled in queued past the threshold', async () => {
    // Six prod spots sat in 'queued' for four months: their BullMQ jobs were gone
    // and the sweep only looked at 'failed', so nothing could ever reach them.
    const { service, added } = makeRetryHarness([
      { id: 'stalled-1', processing_status: 'queued', subject_kind: 'litter', user_id: 'u', image_key: 'k', mime_type: 'image/jpeg', updated_at: minutesAgo(60 * 24 * 120) },
    ]);

    const result = await service.retryFailedSpots(10);

    expect(result.retried).toBe(1);
    expect(added).toHaveLength(1);
  });

  test('leaves a spot that is legitimately still processing alone', async () => {
    // The age bound is the whole safety margin — without it this would yank spots
    // out from under a worker that is mid-detection.
    const { service, added } = makeRetryHarness([
      { id: 'busy-1', processing_status: 'processing', subject_kind: 'litter', user_id: 'u', image_key: 'k', mime_type: 'image/jpeg', updated_at: minutesAgo(2) },
    ]);

    const result = await service.retryFailedSpots(10);

    expect(result.retried).toBe(0);
    expect(result.skipped).toBe(1);
    expect(added).toHaveLength(0);
    expect(result.errors[0].message).toContain('failed or stalled');
  });

  test('refuses a spot whose image was never stored', async () => {
    // Six prod spots carry image_key='' from a 4-minute MinIO outage on
    // 2026-05-14: the row was committed before the upload ran. Re-enqueueing them
    // only produces 'Invalid job payload' on every sweep, forever.
    const { service, added } = makeRetryHarness([
      { id: 'no-image-1', processing_status: 'failed', subject_kind: 'litter', user_id: 'u', image_key: '', mime_type: 'image/jpeg', updated_at: minutesAgo(1) },
    ]);

    const result = await service.retryFailedSpots(10);

    expect(result.retried).toBe(0);
    expect(added).toHaveLength(0);
    expect(result.errors[0].message).toContain('never be processed');
  });
});

function health(overrides: Partial<OverallHealthSignals> = {}): OverallHealthSignals {
  return { workerHealthy: true, retryableFailedSpots: 0, stalledSpots: 0, ...overrides };
}

describe('getOverallHealthStatus', () => {
  test('is ok when nothing needs doing', () => {
    expect(getOverallHealthStatus(health())).toBe('ok');
  });

  test('ignores the cumulative queue failed count entirely', () => {
    // Regression: the badge read `failedJobs > 0` from BullMQ's failed set, which
    // removeOnFail: false keeps forever. Prod carried 9 such entries — every one
    // referencing a spot that had since succeeded or been deleted — so the page
    // said "degraded" permanently and could never return to ok on its own.
    // The signal is not even an input now, so there is nothing to pass.
    expect(getOverallHealthStatus(health())).toBe('ok');
  });

  test('is ok when the only failures are unrecoverable', () => {
    // A spot whose upload never landed can never be processed and the retry sweep
    // refuses it, so it must not imply an action nobody can take. Unrecoverable
    // spots are excluded upstream, so they never reach retryableFailedSpots.
    expect(getOverallHealthStatus(health({ retryableFailedSpots: 0 }))).toBe('ok');
  });

  test('is degraded when a failed spot can actually be retried', () => {
    expect(getOverallHealthStatus(health({ retryableFailedSpots: 1 }))).toBe('degraded');
  });

  test('is degraded when spots are stalled', () => {
    expect(getOverallHealthStatus(health({ stalledSpots: 4 }))).toBe('degraded');
  });

  test('is degraded when the worker is unhealthy', () => {
    expect(getOverallHealthStatus(health({ workerHealthy: false }))).toBe('degraded');
  });
});

describe('AdminOpsService.cleanOrphanedFailedJobs', () => {
  function makeCleanupHarness(failedIds: string[], liveIds: string[]) {
    const removed: string[] = [];
    const service = Object.create(AdminOpsService.prototype) as AdminOpsService;
    Object.assign(service as unknown as Record<string, unknown>, {
      queueName: 'litter-detection',
      logger: { log: () => {}, warn: () => {} },
      detectionQueue: {
        toKey: (type: string) => `bull:litter-detection:${type}`,
        client: Promise.resolve({
          zrange: async () => failedIds,
          // A live job still has its hash; an orphaned id does not.
          exists: async (key: string) => (liveIds.includes(key.replace('bull:litter-detection:', '')) ? 1 : 0),
        }),
        async remove(id: string) {
          removed.push(id);
          return 1;
        },
      },
    });
    return { service, removed };
  }

  test('removes entries with no job data and keeps genuine failures', async () => {
    // Regression: deleting job hashes through raw Redis left their ids stranded in
    // the failed sorted set — unreadable, and rendered as broken rows in the queue
    // detail view.
    const { service, removed } = makeCleanupHarness(
      ['orphan-1', 'real-1', 'orphan-2'],
      ['real-1'],
    );

    const result = await service.cleanOrphanedFailedJobs();

    expect(removed).toEqual(['orphan-1', 'orphan-2']);
    expect(result).toMatchObject({ scanned: 3, kept: 1 });
  });

  test('removes nothing when every entry still has its data', async () => {
    const { service, removed } = makeCleanupHarness(['real-1', 'real-2'], ['real-1', 'real-2']);

    const result = await service.cleanOrphanedFailedJobs();

    expect(removed).toEqual([]);
    expect(result).toMatchObject({ scanned: 2, kept: 2 });
  });
});
