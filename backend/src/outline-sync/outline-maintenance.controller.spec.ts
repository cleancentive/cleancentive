import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { describe, expect, test } from 'bun:test';

import { AdminGuard } from '../admin/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OutlineMaintenanceController } from './outline-maintenance.controller';

describe('OutlineMaintenanceController', () => {
  test('is an admin-only controller under outline-maintenance', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OutlineMaintenanceController)).toBe('outline-maintenance');
    expect(Reflect.getMetadata(GUARDS_METADATA, OutlineMaintenanceController)).toEqual([JwtAuthGuard, AdminGuard]);
  });

  test('exposes wipe and initialize POST endpoints', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OutlineMaintenanceController.prototype.wipeContent)).toBe('wipe-content');
    expect(Reflect.getMetadata(METHOD_METADATA, OutlineMaintenanceController.prototype.wipeContent)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, OutlineMaintenanceController.prototype.initializeContent)).toBe('initialize-content');
    expect(Reflect.getMetadata(METHOD_METADATA, OutlineMaintenanceController.prototype.initializeContent)).toBe(RequestMethod.POST);
  });

  test('refuses wipe requests without confirmation', async () => {
    const controller = new OutlineMaintenanceController({ wipeOutlineContentOnce: async () => ({}) } as any);

    await expect(controller.wipeContent({})).rejects.toThrow(BadRequestException);
    await expect(controller.wipeContent(undefined as any)).rejects.toThrow(BadRequestException);
  });

  test('delegates confirmed wipe and initialization to OutlineSyncService', async () => {
    const calls: string[] = [];
    const controller = new OutlineMaintenanceController({
      wipeOutlineContentOnce: async (confirmation: string) => {
        calls.push(`wipe:${confirmation}`);
        return { confirmation, outline: {}, cleancentive: { teamOutlineCollections: 0 } };
      },
      initializeOutlineContentOnce: async () => {
        calls.push('initialize');
        return {
          gettingStarted: { created: true },
          teams: { created: 0, skipped: 0 },
          stewards: { publicCreated: false, confidentialCreated: false },
        };
      },
    } as any);

    await expect(controller.wipeContent({ confirmation: 'WIPE_OUTLINE_CONTENT' })).resolves.toEqual({
      confirmation: 'WIPE_OUTLINE_CONTENT',
      outline: {},
      cleancentive: { teamOutlineCollections: 0 },
    });
    await expect(controller.initializeContent()).resolves.toEqual({
      gettingStarted: { created: true },
      teams: { created: 0, skipped: 0 },
      stewards: { publicCreated: false, confidentialCreated: false },
    });
    expect(calls).toEqual(['wipe:WIPE_OUTLINE_CONTENT', 'initialize']);
  });
});
