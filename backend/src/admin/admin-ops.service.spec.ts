import { describe, expect, test } from 'bun:test';

import { AdminOpsService } from './admin-ops.service';

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
