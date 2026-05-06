import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, test } from 'bun:test';

import { CleanupController } from './cleanup.controller';

function makeController() {
  const calls: any[] = [];
  const cleanupService = {
    createCleanup: async (userId: string, input: any) => {
      calls.push({ method: 'createCleanup', userId, input });
      return { id: 'c1' };
    },
    addDate: async (cleanupId: string, userId: string, input: any) => {
      calls.push({ method: 'addDate', cleanupId, userId, input });
      return { id: 'd1' };
    },
    updateDate: async (cleanupDateId: string, userId: string, input: any) => {
      calls.push({ method: 'updateDate', cleanupDateId, userId, input });
      return { id: cleanupDateId };
    },
  } as any;
  const adminService = {} as any;
  const controller = new CleanupController(cleanupService, adminService);
  return { controller, calls };
}

describe('CleanupController datetime parsing', () => {
  test('createCleanup accepts ISO with Z and parses to absolute moment', async () => {
    const { controller, calls } = makeController();
    await controller.createCleanup(
      { user: { userId: 'u1' } },
      {
        name: 'x',
        description: '',
        date: {
          startAt: '2026-05-06T08:00:00.000Z',
          endAt: '2026-05-06T10:00:00.000Z',
          latitude: 47,
          longitude: 8,
        },
      },
    );
    const startAt = calls[0].input.date.startAt as Date;
    const endAt = calls[0].input.date.endAt as Date;
    expect(startAt.toISOString()).toBe('2026-05-06T08:00:00.000Z');
    expect(endAt.toISOString()).toBe('2026-05-06T10:00:00.000Z');
  });

  test('createCleanup accepts ISO with explicit offset', async () => {
    const { controller, calls } = makeController();
    await controller.createCleanup(
      { user: { userId: 'u1' } },
      {
        name: 'x',
        description: '',
        date: {
          startAt: '2026-05-06T10:00:00+02:00',
          endAt: '2026-05-06T12:00:00+02:00',
          latitude: 47,
          longitude: 8,
        },
      },
    );
    const startAt = calls[0].input.date.startAt as Date;
    expect(startAt.toISOString()).toBe('2026-05-06T08:00:00.000Z');
  });

  test('createCleanup rejects naive datetime-local string', async () => {
    const { controller } = makeController();
    await expect(
      controller.createCleanup(
        { user: { userId: 'u1' } },
        {
          name: 'x',
          description: '',
          date: {
            startAt: '2026-05-06T10:00',
            endAt: '2026-05-06T12:00',
            latitude: 47,
            longitude: 8,
          },
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test('addDate rejects missing startAt', async () => {
    const { controller } = makeController();
    await expect(
      controller.addDate(
        { user: { userId: 'u1' } },
        'cleanup-1',
        { endAt: '2026-05-06T12:00:00Z', latitude: 0, longitude: 0 } as any,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test('updateDate rejects naive end', async () => {
    const { controller } = makeController();
    await expect(
      controller.updateDate(
        { user: { userId: 'u1' } },
        'date-1',
        {
          startAt: '2026-05-06T10:00:00Z',
          endAt: '2026-05-06T12:00',
          latitude: 0,
          longitude: 0,
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
