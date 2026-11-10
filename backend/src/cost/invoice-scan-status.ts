import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConnection } from '../common/redis-connection';
import type { InvoiceScanStatus } from './cost.types';

const STATUS_KEY = 'cost:invoice-scan';
/** Long enough that "last scan" still means something after a quiet week. */
const STATUS_TTL_SECONDS = 7 * 24 * 3600;

export const IDLE_SCAN_STATUS: InvoiceScanStatus = {
  state: 'idle',
  total: 0,
  done: 0,
  current: null,
  ingested: 0,
  failed: 0,
  skipped: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

/**
 * The invoice scan's progress, shared between the job that does the work and
 * the steward page that polls for it. Every method swallows Redis errors: a
 * progress bar is never a reason for a scan to fail.
 */
@Injectable()
export class InvoiceScanStatusStore implements OnModuleDestroy {
  private readonly redis = new Redis(redisConnection());

  async get(): Promise<InvoiceScanStatus> {
    try {
      const raw = await this.redis.get(STATUS_KEY);
      return raw ? { ...IDLE_SCAN_STATUS, ...(JSON.parse(raw) as Partial<InvoiceScanStatus>) } : IDLE_SCAN_STATUS;
    } catch {
      return IDLE_SCAN_STATUS;
    }
  }

  async set(status: InvoiceScanStatus): Promise<void> {
    await this.redis.set(STATUS_KEY, JSON.stringify(status), 'EX', STATUS_TTL_SECONDS).catch(() => undefined);
  }

  /**
   * Marks a scan as waiting, keeping the previous run's figures visible.
   *
   * A running scan is left alone: the queue already folds a second request into
   * the pending job, and "queued" would hide the progress of the one underway.
   */
  async markQueued(): Promise<void> {
    const current = await this.get();
    if (current.state === 'running') return;
    await this.set({ ...current, state: 'queued', error: null });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
