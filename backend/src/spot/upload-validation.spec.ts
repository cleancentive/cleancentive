import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import sharp = require('sharp');
import { SpotController } from './spot.controller';

/**
 * The declared Content-Type on a multipart part is whatever the uploader wrote,
 * and it decided both the stored object's content type and its file extension.
 * The uploadId went straight into the S3 key.
 */

function makeController() {
  const created: Array<Record<string, any>> = [];
  const controller: any = Object.create(SpotController.prototype);
  controller.maxUploadSizeBytes = 15 * 1024 * 1024;
  controller.accuracySanityBoundMeters = 10000;
  controller.spotService = {
    createSpot: async (input: Record<string, any>) => {
      created.push(input);
      return { spot: { id: 'spot-1', processing_status: 'queued' }, warning: null };
    },
  };
  controller.userService = { findOrCreateGuest: async (id: string) => ({ id }) };
  return { controller: controller as SpotController, created };
}

function request(body: Record<string, string>) {
  return { body, user: { userId: 'user-1', isGuest: false } } as any;
}

const VALID_BODY = {
  uploadId: '0199b3d2-1c00-7000-8000-000000000001',
  latitude: '47.3769',
  longitude: '8.5417',
  capturedAt: new Date().toISOString(),
};

async function pngBytes(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
}

describe('createSpot upload validation', () => {
  test('stores the type the bytes say, not the one the client declared', async () => {
    const { controller, created } = makeController();
    const files = { image: [{ buffer: await pngBytes(), mimetype: 'image/jpeg', size: 100 }] };

    await controller.createSpot(files as any, request({ ...VALID_BODY }));

    expect(created[0].mimeType).toBe('image/png');
  });

  test('refuses a file that is not an image at all', async () => {
    const { controller } = makeController();
    const files = {
      image: [{ buffer: Buffer.from('#!/bin/sh\nrm -rf /\n'), mimetype: 'image/jpeg', size: 20 }],
    };

    await expect(
      controller.createSpot(files as any, request({ ...VALID_BODY })),
    ).rejects.toThrow(BadRequestException);
  });

  test('accepts HEIC, which the camera roll produces and sharp cannot decode', async () => {
    const { controller, created } = makeController();
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic'),
      Buffer.alloc(64),
    ]);
    const files = { image: [{ buffer: heic, mimetype: 'application/octet-stream', size: 76 }] };

    await controller.createSpot(files as any, request({ ...VALID_BODY }));

    expect(created[0].mimeType).toBe('image/heic');
  });

  test('refuses an uploadId that is not a uuid, since it lands in the S3 key', async () => {
    const { controller } = makeController();
    const files = { image: [{ buffer: await pngBytes(), mimetype: 'image/png', size: 100 }] };

    await expect(
      controller.createSpot(files as any, request({ ...VALID_BODY, uploadId: '../../evil' })),
    ).rejects.toThrow('uploadId must be a UUID');
  });
});
