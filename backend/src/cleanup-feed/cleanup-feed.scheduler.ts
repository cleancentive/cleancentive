import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { redisConnection } from '../common/redis-connection';
import { CleanupFeedService } from './cleanup-feed.service';
import type { ReconcilePlan } from './reconciler';

const QUEUE_NAME = 'cleancentive-cleanup-feeds';
const PREVIEW_TTL_SECONDS = 60 * 60;

export type PreviewState =
  | { state: 'none' }
  | { state: 'queued'; requestedAt: string }
  | { state: 'running'; requestedAt: string }
  | { state: 'done'; requestedAt: string; finishedAt: string; plan: PreviewPlan }
  | { state: 'failed'; requestedAt: string; finishedAt: string; error: string };

/** What a dry run shows a steward: one row per thing that would happen. */
export interface PreviewPlan {
  entries: Array<{
    action: 'create' | 'adopt' | 'update' | 'archive' | 'unchanged' | 'error';
    name: string;
    startAt: string | null;
    cleanupId: string | null;
    note: string | null;
  }>;
}

@Injectable()
export class CleanupFeedScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleanupFeedScheduler.name);
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly redis: Redis;

  constructor(private readonly feedService: CleanupFeedService) {
    this.redis = new Redis(redisConnection());
    this.queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        if (job.name === 'refresh-all') {
          await this.refreshAll();
          return;
        }
        const { feedId, dryRun } = job.data as { feedId: string; dryRun: boolean };
        await this.runOne(feedId, dryRun);
      },
      // One at a time: two runs of the same feed would race on the same rows,
      // and a source should never see us as more than one visitor.
      { connection: redisConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Cleanup feed job ${job?.name} failed: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    if (!this.isEnabled()) {
      this.logger.log('Cleanup feeds disabled (CLEANUP_FEEDS_ENABLED=false)');
      return;
    }

    const pattern = process.env.CLEANUP_FEEDS_CRON || '15 5 * * *';
    await this.queue.add('refresh-all', {}, { repeat: { pattern }, removeOnComplete: true, removeOnFail: false });
    this.logger.log(`Cleanup feed refresh registered: ${pattern}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.redis?.disconnect();
  }

  isEnabled(): boolean {
    return process.env.CLEANUP_FEEDS_ENABLED !== 'false';
  }

  async getNextRunAt(): Promise<string | null> {
    const jobs = await this.queue.getRepeatableJobs();
    const next = jobs.find((job) => job.name === 'refresh-all')?.next;
    return next ? new Date(next).toISOString() : null;
  }

  /** Queues a refresh. Never inline: feed writes must not be attributed to the caller. */
  async requestRefresh(feedId: string, dryRun: boolean): Promise<void> {
    if (dryRun) {
      await this.setPreview(feedId, { state: 'queued', requestedAt: new Date().toISOString() });
    }
    await this.queue.add(
      'refresh-feed',
      { feedId, dryRun },
      {
        jobId: `refresh-feed:${feedId}:${dryRun ? 'dry' : 'real'}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: dryRun ? 1 : 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
  }

  async getPreview(feedId: string): Promise<PreviewState> {
    const raw = await this.redis.get(this.previewKey(feedId));
    return raw ? (JSON.parse(raw) as PreviewState) : { state: 'none' };
  }

  private async refreshAll(): Promise<void> {
    const feeds = await this.feedService.listEnabledFeeds();
    for (const feed of feeds) {
      try {
        await this.feedService.refreshFeed(feed.id, false);
      } catch (error) {
        // Already recorded on the feed row; one bad source must not stop the rest.
        this.logger.warn(`Cleanup feed ${feed.id} skipped: ${(error as Error).message}`);
      }
    }
  }

  private async runOne(feedId: string, dryRun: boolean): Promise<void> {
    const requestedAt = dryRun ? (await this.getPreview(feedId)) : null;
    const requested = requestedAt && 'requestedAt' in requestedAt ? requestedAt.requestedAt : new Date().toISOString();

    if (dryRun) {
      await this.setPreview(feedId, { state: 'running', requestedAt: requested });
    }

    try {
      const { plan } = await this.feedService.refreshFeed(feedId, dryRun);
      if (dryRun) {
        await this.setPreview(feedId, {
          state: 'done',
          requestedAt: requested,
          finishedAt: new Date().toISOString(),
          plan: toPreviewPlan(plan),
        });
      }
    } catch (error) {
      if (dryRun) {
        await this.setPreview(feedId, {
          state: 'failed',
          requestedAt: requested,
          finishedAt: new Date().toISOString(),
          error: (error as Error).message,
        });
      }
      throw error;
    }
  }

  private async setPreview(feedId: string, state: PreviewState): Promise<void> {
    await this.redis.set(this.previewKey(feedId), JSON.stringify(state), 'EX', PREVIEW_TTL_SECONDS);
  }

  private previewKey(feedId: string): string {
    return `cleanup-feed:preview:${feedId}`;
  }
}

export function toPreviewPlan(plan: ReconcilePlan): PreviewPlan {
  return {
    entries: [
      ...plan.creates.map((create) => ({
        action: 'create' as const,
        name: create.name,
        startAt: create.external.startAt.toISOString(),
        cleanupId: null,
        note: null,
      })),
      ...plan.adoptions.map((adoption) => ({
        action: 'adopt' as const,
        name: adoption.external.title,
        startAt: adoption.external.startAt.toISOString(),
        cleanupId: adoption.cleanupId,
        note: null,
      })),
      ...plan.updates.map((update) => ({
        action: 'update' as const,
        name: update.name,
        startAt: update.external.startAt.toISOString(),
        cleanupId: update.cleanupId,
        note: Object.keys(update.changes).join(', '),
      })),
      ...plan.archives.map((archive) => ({
        action: 'archive' as const,
        name: archive.name,
        startAt: null,
        cleanupId: archive.cleanupId,
        note: null,
      })),
      ...plan.errors.map((error) => ({
        action: 'error' as const,
        name: error.title,
        startAt: null,
        cleanupId: null,
        note: error.reason,
      })),
    ],
  };
}
