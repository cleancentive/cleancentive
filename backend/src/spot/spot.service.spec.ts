import { describe, expect, test } from 'bun:test';
import sharp = require('sharp');
import { Readable } from 'node:stream';

import { SpotService } from './spot.service';
import type { Spot } from './spot.entity';

type QueryBuilderCalls = {
  orderBy: Array<[string, string]>;
  addOrderBy: Array<[string, string]>;
  take: number | null;
  andWhere: Array<{ clause: string; params: Record<string, unknown> }>;
};

function makeSpot(captured_at: string, id: string): Spot {
  return {
    id,
    captured_at: new Date(captured_at),
    items: [],
  } as unknown as Spot;
}

function makeRepository(rows: Spot[]) {
  const calls: QueryBuilderCalls = { orderBy: [], addOrderBy: [], take: null, andWhere: [] };

  const qb: Record<string, unknown> = {};
  Object.assign(qb, {
    leftJoinAndSelect: () => qb,
    where: () => qb,
    orderBy: (field: string, dir: string) => { calls.orderBy.push([field, dir]); return qb; },
    addOrderBy: (field: string, dir: string) => { calls.addOrderBy.push([field, dir]); return qb; },
    take: (n: number) => { calls.take = n; return qb; },
    andWhere: (clause: string, params: Record<string, unknown>) => {
      calls.andWhere.push({ clause, params });
      return qb;
    },
    getMany: async () => rows,
  });

  return {
    repository: { createQueryBuilder: () => qb } as never,
    calls,
  };
}

function makeService(rows: Spot[]) {
  const { repository, calls } = makeRepository(rows);
  const service = Object.create(SpotService.prototype) as SpotService;
  (service as unknown as { spotRepository: unknown }).spotRepository = repository;
  return { service, calls };
}

describe('SpotService.listSpotsForUser cursor pagination', () => {
  test('orders by (captured_at DESC, id DESC) and fetches limit + 1', async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      makeSpot(`2026-05-${String(10 - i).padStart(2, '0')}T00:00:00.000Z`, `id-${i}`),
    );
    const { service, calls } = makeService(rows);

    await service.listSpotsForUser('user-1', 3);

    expect(calls.orderBy).toEqual([['spot.captured_at', 'DESC']]);
    expect(calls.addOrderBy).toEqual([['spot.id', 'DESC']]);
    expect(calls.take).toBe(4);
  });

  test('returns nextCursor encoding last item when more rows exist', async () => {
    const rows = [
      makeSpot('2026-05-10T00:00:00.000Z', 'id-a'),
      makeSpot('2026-05-09T00:00:00.000Z', 'id-b'),
      makeSpot('2026-05-08T00:00:00.000Z', 'id-c'),
      makeSpot('2026-05-07T00:00:00.000Z', 'id-d'),
    ];
    const { service } = makeService(rows);

    const page = await service.listSpotsForUser('user-1', 3);

    expect(page.items).toHaveLength(3);
    expect(page.items.map((s) => s.id)).toEqual(['id-a', 'id-b', 'id-c']);
    expect(page.nextCursor).toBe('2026-05-08T00:00:00.000Z|id-c');
  });

  test('returns nextCursor null on the last page', async () => {
    const rows = [
      makeSpot('2026-05-10T00:00:00.000Z', 'id-a'),
      makeSpot('2026-05-09T00:00:00.000Z', 'id-b'),
    ];
    const { service } = makeService(rows);

    const page = await service.listSpotsForUser('user-1', 5);

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  test('applies before cursor as a tuple comparison', async () => {
    const { service, calls } = makeService([]);

    await service.listSpotsForUser('user-1', 3, {
      before: '2026-05-08T00:00:00.000Z|id-c',
    });

    const beforeAndWhere = calls.andWhere.find((w) =>
      w.clause.includes('spot.captured_at') && w.clause.includes('spot.id'),
    );
    expect(beforeAndWhere).toBeDefined();
    expect(beforeAndWhere?.clause).toBe('(spot.captured_at, spot.id) < (:beforeAt, :beforeId)');
    expect(beforeAndWhere?.params).toEqual({
      beforeAt: '2026-05-08T00:00:00.000Z',
      beforeId: 'id-c',
    });
  });

  test('ignores malformed before cursor', async () => {
    const { service, calls } = makeService([]);

    await service.listSpotsForUser('user-1', 3, { before: 'no-pipe' });

    const tupleClause = calls.andWhere.find((w) => w.clause.includes('spot.captured_at, spot.id'));
    expect(tupleClause).toBeUndefined();
  });

  test('cursor consistency: page 2 with cursor skips an inserted newer spot', async () => {
    // Page 1 returns 3 items + nextCursor, ignoring a spot inserted later that's newer than the page-1 head.
    const page1Rows = [
      makeSpot('2026-05-10T00:00:00.000Z', 'id-a'),
      makeSpot('2026-05-09T00:00:00.000Z', 'id-b'),
      makeSpot('2026-05-08T00:00:00.000Z', 'id-c'),
      makeSpot('2026-05-07T00:00:00.000Z', 'id-d'),
    ];
    const page1 = await makeService(page1Rows).service.listSpotsForUser('user-1', 3);
    expect(page1.nextCursor).toBe('2026-05-08T00:00:00.000Z|id-c');

    // Between requests, a newer spot is inserted. Page 2 fetched with the cursor must not see it.
    const page2Rows = [
      makeSpot('2026-05-07T00:00:00.000Z', 'id-d'),
    ];
    const { service: page2Service, calls: page2Calls } = makeService(page2Rows);
    const page2 = await page2Service.listSpotsForUser('user-1', 3, { before: page1.nextCursor! });

    expect(page2.items.map((s) => s.id)).toEqual(['id-d']);
    expect(page2.nextCursor).toBeNull();
    // The newer-than-page-1 spot is excluded by the WHERE predicate the service constructed:
    const beforePredicate = page2Calls.andWhere.find((w) => w.clause.includes('(spot.captured_at, spot.id)'));
    expect(beforePredicate?.params).toEqual({
      beforeAt: '2026-05-08T00:00:00.000Z',
      beforeId: 'id-c',
    });
  });
});

type UpdateCall = { entity: string; criteria: Record<string, unknown>; patch: Record<string, unknown> };

function makeConfirmHarness(spot: Spot | null, affected = 0) {
  const updates: UpdateCall[] = [];
  const editsWritten: unknown[] = [];

  const manager = {
    async update(entity: { name: string }, criteria: Record<string, unknown>, patch: Record<string, unknown>) {
      updates.push({ entity: entity.name, criteria, patch });
      return { affected };
    },
    async save(row: unknown) {
      editsWritten.push(row);
      return row;
    },
  };

  const service = Object.create(SpotService.prototype) as SpotService;
  Object.assign(service as unknown as Record<string, unknown>, {
    spotRepository: { findOne: async () => spot, manager: { clear: () => {} } },
    detectedItemRepository: { manager: { clear: () => {} } },
    dataSource: { transaction: async (cb: (m: unknown) => Promise<unknown>) => cb(manager) },
  });

  return { service, updates, editsWritten };
}

describe('SpotService.confirmDetection', () => {
  test('verifies the spot items without writing a single edit row', async () => {
    // The asymmetry is the point. A fix writes to detected_item_edits; a
    // confirmation writes nothing. Before this existed, human_verified could only
    // be set by *changing* something, so the record held every case the model got
    // wrong and no case it got right — 603 of 603 verified items had been edited,
    // which reads as 0% accuracy but is really an artifact of the write path.
    const { service, updates, editsWritten } = makeConfirmHarness({ id: 'spot-1' } as Spot, 3);

    const result = await service.confirmDetection('spot-1', 'steward-1');

    expect(result).toMatchObject({ spotId: 'spot-1', itemsConfirmed: 3 });
    expect(editsWritten).toHaveLength(0);

    const itemUpdate = updates.find((u) => u.entity === 'DetectedItem');
    expect(itemUpdate?.criteria).toEqual({ spot_id: 'spot-1', human_verified: false });
    expect(itemUpdate?.patch).toEqual({ human_verified: true });
  });

  test('stamps the spot so a review with no detected items still counts', async () => {
    // "The model correctly found nothing" is signal, and a spot with zero items
    // has no row to flag — so the marker has to live on the spot.
    const { service, updates } = makeConfirmHarness({ id: 'spot-2' } as Spot, 0);

    const result = await service.confirmDetection('spot-2', 'steward-1');

    const spotUpdate = updates.find((u) => u.entity === 'Spot');
    expect(spotUpdate?.criteria).toEqual({ id: 'spot-2' });
    expect(spotUpdate?.patch.detection_reviewed_by).toBe('steward-1');
    expect(spotUpdate?.patch.detection_reviewed_at).toEqual(result.reviewedAt);
    expect(result.itemsConfirmed).toBe(0);
  });

  test('rejects an unknown spot', async () => {
    const { service } = makeConfirmHarness(null);
    await expect(service.confirmDetection('missing', 'steward-1')).rejects.toThrow('Spot not found');
  });
});

function cleanJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#0a0' } }).jpeg().toBuffer();
}

async function jpegWithExif(): Promise<Buffer> {
  return sharp(await cleanJpeg())
    .withExif({ IFD0: { Copyright: 'test', Make: 'TestCam' } })
    .jpeg()
    .toBuffer();
}

async function toBuffer(body: NodeJS.ReadableStream | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  const chunks: Buffer[] = [];
  for await (const chunk of body as unknown as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function makeOriginalService(spot: Partial<Spot> | null, stored: Buffer, isAdmin = false) {
  const service = Object.create(SpotService.prototype) as SpotService;
  const inject = service as unknown as Record<string, unknown>;

  inject.spotRepository = { findOne: async () => spot };
  inject.bucketName = 'test-bucket';
  inject.adminService = { isAdmin: async () => isAdmin };
  inject.s3Client = {
    send: async () => {
      const body = Readable.from([stored]) as Readable & {
        transformToByteArray: () => Promise<Uint8Array>;
      };
      body.transformToByteArray = async () => new Uint8Array(stored);
      return { Body: body };
    },
  };

  return service;
}

const ownedSpot = {
  id: 'spot-1',
  user_id: 'owner-1',
  mime_type: 'image/jpeg',
  image_key: 'spots/spot-1/original-u1.jpg',
  thumbnail_key: 'spots/spot-1/thumbnail-u1.jpg',
  original_purged_at: null,
} as unknown as Spot;

describe('SpotService.getOriginalStream', () => {
  test('returns null once the original has been purged', async () => {
    const service = makeOriginalService(
      { ...ownedSpot, original_purged_at: new Date() } as Spot,
      Buffer.from('irrelevant'),
    );

    expect(await service.getOriginalStream('spot-1', 'owner-1')).toBeNull();
  });

  test('returns null for a spot stranded without an image key', async () => {
    const service = makeOriginalService({ ...ownedSpot, image_key: '' } as Spot, Buffer.from('x'));

    expect(await service.getOriginalStream('spot-1', 'owner-1')).toBeNull();
  });

  test('returns null when the spot does not exist', async () => {
    const service = makeOriginalService(null, Buffer.from('x'));

    expect(await service.getOriginalStream('missing', 'owner-1')).toBeNull();
  });

  test('gives the owner the stored bytes with their EXIF intact', async () => {
    const stored = await jpegWithExif();
    const service = makeOriginalService(ownedSpot, stored);

    const result = await service.getOriginalStream('spot-1', 'owner-1');

    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('image/jpeg');
    const served = await toBuffer(result!.body);
    expect(served.equals(stored)).toBe(true);
    expect((await sharp(served).metadata()).exif).toBeTruthy();
  });

  test('gives a steward the stored bytes even though they do not own the spot', async () => {
    const stored = await jpegWithExif();
    const service = makeOriginalService(ownedSpot, stored, true);

    const result = await service.getOriginalStream('spot-1', 'steward-9');

    const served = await toBuffer(result!.body);
    expect(served.equals(stored)).toBe(true);
  });

  test('strips EXIF for an anonymous viewer', async () => {
    const stored = await jpegWithExif();
    const service = makeOriginalService(ownedSpot, stored);

    const result = await service.getOriginalStream('spot-1', null);

    const served = await toBuffer(result!.body);
    const metadata = await sharp(served).metadata();
    expect(metadata.exif).toBeFalsy();
    expect(metadata.xmp).toBeFalsy();
    // Still a real image, not an empty buffer.
    expect(metadata.width).toBe(8);
  });

  test('strips EXIF for a signed-in viewer who is neither owner nor steward', async () => {
    const stored = await jpegWithExif();
    const service = makeOriginalService(ownedSpot, stored);

    const result = await service.getOriginalStream('spot-1', 'someone-else');

    expect((await sharp(await toBuffer(result!.body)).metadata()).exif).toBeFalsy();
  });

  test('passes a metadata-free original through byte-for-byte rather than re-encoding', async () => {
    const stored = await cleanJpeg();
    const service = makeOriginalService(ownedSpot, stored);

    const result = await service.getOriginalStream('spot-1', null);

    const served = await toBuffer(result!.body);
    expect(served.equals(stored)).toBe(true);
  });
});
