import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Spot } from '../spot/spot.entity';
import { DetectedItem } from '../spot/detected-item.entity';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { S3Client, HeadBucketCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { StorageService } from '../storage/storage.service';
import { PurgeService } from '../purge/purge.service';
import { redisConnection } from '../common/redis-connection';
import { createS3Client } from '../common/s3-client';
import { PROCESSING_STATUS } from '@cleancentive/shared';

type HealthStatus = 'ok' | 'degraded' | 'down';

interface WorkerOpsState {
  name: string;
  lastHeartbeatAt?: string;
  lastJobStartedAt?: string;
  lastJobCompletedAt?: string;
  lastJobFailedAt?: string;
  lastFailedError?: string | null;
  concurrency: number;
  hostname: string;
  pid: number;
  commit?: string;
  commitShort?: string;
  buildTime?: number;
}

@Injectable()
export class AdminOpsService implements OnModuleDestroy {
  private readonly logger = new Logger(AdminOpsService.name);
  private readonly queueName = process.env.DETECTION_QUEUE_NAME || 'litter-detection';
  private readonly workerOpsKey = `ops:worker:${this.queueName}`;
  private readonly workerHeartbeatTtlSeconds = 30;
  private readonly stalledAfterMinutes = parseInt(process.env.DETECTION_HEALTH_STUCK_MINUTES || '30', 10);
  private readonly bucketName = process.env.S3_BUCKET || 'cleancentive-images';
  private readonly detectionQueue: Queue;
  private readonly redisClient: Redis;
  private readonly s3Client: S3Client;

  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
    @InjectRepository(DetectedItem)
    private readonly detectedItemRepository: Repository<DetectedItem>,
    private readonly storageService: StorageService,
    private readonly purgeService: PurgeService,
  ) {
    this.detectionQueue = new Queue(this.queueName, {
      connection: redisConnection(),
    });

    this.redisClient = new Redis(redisConnection());

    this.s3Client = createS3Client();
  }

  async onModuleDestroy(): Promise<void> {
    await this.detectionQueue.close();
    await this.redisClient.quit();
  }

  async getOverview() {
    const [queue, spots, worker] = await Promise.all([
      this.getQueueSummary(),
      this.getSpotSummary(),
      this.getWorkerSummary(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      health: {
        status: this.getOverallHealthStatus(queue.counts.failed, worker.healthy),
      },
      queue,
      spots,
      worker: {
        healthy: worker.healthy,
        lastHeartbeatAt: worker.lastHeartbeatAt,
        lastJobStartedAt: worker.lastJobStartedAt,
        lastJobCompletedAt: worker.lastJobCompletedAt,
        lastJobFailedAt: worker.lastJobFailedAt,
      },
    };
  }

  async getQueue(failedLimit: number) {
    const [queue, recentFailed] = await Promise.all([
      this.getQueueSummary(),
      this.getRecentFailedJobs(failedLimit),
    ]);

    return {
      timestamp: new Date().toISOString(),
      queue: {
        ...queue,
        recentFailed,
      },
    };
  }

  async getSpots(failureLimit: number) {
    const spots = await this.getSpotSummary();
    const recentFailures = await this.spotRepository.query(
      `
        SELECT id, user_id, updated_at, processing_error
        FROM spots
        WHERE processing_status = 'failed'
        ORDER BY updated_at DESC
        LIMIT $1
      `,
      [failureLimit],
    );

    return {
      timestamp: new Date().toISOString(),
      spots: {
        ...spots,
        recentFailures: recentFailures.map((failure: Record<string, unknown>) => ({
          spotId: failure.id,
          userId: failure.user_id,
          updatedAt: failure.updated_at,
          error: failure.processing_error,
        })),
      },
    };
  }

  async getWorker() {
    const worker = await this.getWorkerSummary();
    return {
      timestamp: new Date().toISOString(),
      worker,
    };
  }

  async getHealth() {
    const [postgres, redis, minio, worker] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMinio(),
      this.getWorkerSummary(),
    ]);

    let status: HealthStatus = 'ok';
    if (postgres.status === 'down' || redis.status === 'down' || minio.status === 'down') {
      status = 'down';
    } else if (!worker.healthy) {
      status = 'degraded';
    }

    return {
      timestamp: new Date().toISOString(),
      status,
      checks: {
        backend: { status: 'ok' },
        postgres,
        redis,
        minio,
        worker: {
          status: worker.healthy ? 'ok' : 'degraded',
          lastHeartbeatAt: worker.lastHeartbeatAt,
        },
      },
    };
  }

  /**
   * The next spots awaiting a steward's eye, oldest first.
   *
   * Only completed litter spots: a failed spot has nothing to review, and plant
   * identification is scored by Pl@ntNet's own confidence rather than by label
   * correction.
   */
  async getReviewQueue(limit: number) {
    const spots = await this.spotRepository.query(
      `
        SELECT s.id,
               s.created_at,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'id', di.id,
                     'objectLabel', CASE WHEN di.object_label_id IS NULL THEN NULL
                                         ELSE json_build_object('id', di.object_label_id, 'name', ol.name) END,
                     'materialLabel', CASE WHEN di.material_label_id IS NULL THEN NULL
                                           ELSE json_build_object('id', di.material_label_id, 'name', ml.name) END,
                     'brandLabel', CASE WHEN di.brand_label_id IS NULL THEN NULL
                                        ELSE json_build_object('id', di.brand_label_id, 'name', bl.name) END,
                     'weightGrams', di.weight_grams,
                     'confidence', di.confidence
                   ) ORDER BY di.created_at
                 ) FILTER (WHERE di.id IS NOT NULL),
                 '[]'
               ) AS items
        FROM spots s
        LEFT JOIN detected_items di ON di.spot_id = s.id
        LEFT JOIN label_translations ol ON ol.label_id = di.object_label_id AND ol.locale = 'en'
        LEFT JOIN label_translations ml ON ml.label_id = di.material_label_id AND ml.locale = 'en'
        LEFT JOIN label_translations bl ON bl.label_id = di.brand_label_id AND bl.locale = 'en'
        WHERE s.detection_reviewed_at IS NULL
          AND s.processing_status = 'completed'
          AND s.subject_kind = 'litter'
        GROUP BY s.id, s.created_at
        ORDER BY s.created_at ASC
        LIMIT $1
      `,
      [limit],
    );

    return {
      timestamp: new Date().toISOString(),
      spots: spots.map((spot: Record<string, unknown>) => ({
        spotId: spot.id,
        createdAt: spot.created_at,
        items: spot.items,
      })),
    };
  }

  /**
   * Numbers for the review page. Deliberately collective and effort-based rather
   * than a per-steward score: rewarding volume or agreement would invite
   * rubber-stamping, and rubber-stamped confirmations corrupt the very accuracy
   * measure the review queue exists to produce.
   */
  async getReviewStats(userId: string) {
    const [row] = await this.spotRepository.query(
      `
        SELECT
          (SELECT COUNT(*) FROM spots
             WHERE detection_reviewed_at IS NULL
               AND processing_status = 'completed'
               AND subject_kind = 'litter') AS backlog,
          (SELECT COUNT(*) FROM spots
             WHERE detection_reviewed_at > NOW() - INTERVAL '7 days') AS reviewed_by_team_this_week,
          (SELECT COUNT(*) FROM spots
             WHERE detection_reviewed_by = $1
               AND detection_reviewed_at > NOW() - INTERVAL '7 days') AS reviewed_by_me_this_week,
          (SELECT COUNT(DISTINCT detection_reviewed_at::date) FROM spots
             WHERE detection_reviewed_by = $1) AS my_active_days
      `,
      [userId],
    );

    // Agreement is measured over reviewed spots, where a confirmation and a fix
    // are both recorded — so the denominator finally exists.
    const [agreement] = await this.spotRepository.query(
      `
        SELECT
          COUNT(*) AS reviewed_items,
          COUNT(*) FILTER (WHERE e.detected_item_id IS NULL) AS untouched_items
        FROM detected_items di
        JOIN spots s ON s.id = di.spot_id AND s.detection_reviewed_at IS NOT NULL
        LEFT JOIN (SELECT DISTINCT detected_item_id FROM detected_item_edits) e
          ON e.detected_item_id = di.id
        WHERE di.source_model IS DISTINCT FROM 'manual'
      `,
    );

    const reviewedItems = Number(agreement?.reviewed_items ?? 0);
    const untouchedItems = Number(agreement?.untouched_items ?? 0);

    return {
      timestamp: new Date().toISOString(),
      backlog: Number(row?.backlog ?? 0),
      reviewedByTeamThisWeek: Number(row?.reviewed_by_team_this_week ?? 0),
      reviewedByMeThisWeek: Number(row?.reviewed_by_me_this_week ?? 0),
      myActiveDays: Number(row?.my_active_days ?? 0),
      modelAgreement: {
        reviewedItems,
        untouchedItems,
        // Null rather than 0 until anything has been reviewed — an empty
        // denominator is "unknown", not "the model is always wrong".
        rate: reviewedItems > 0 ? untouchedItems / reviewedItems : null,
      },
    };
  }

  async retryFailedSpots(limit: number) {
    // Also sweeps spots stalled in queued/processing, not just failed ones. Six
    // spots sat in 'queued' for four months because nothing could reach them:
    // their BullMQ jobs were gone, so no retry would ever fire, and the sweep
    // only looked at 'failed'. The age bound is what keeps this from grabbing a
    // spot that is legitimately being processed right now.
    const failedSpots = await this.spotRepository.query(
      `
        SELECT id
        FROM spots
        WHERE image_key <> ''
          AND (processing_status = 'failed'
               OR (processing_status IN ('queued', 'processing')
                   AND updated_at < NOW() - ($2 || ' minutes')::interval))
        ORDER BY updated_at ASC
        LIMIT $1
      `,
      [limit, String(this.stalledAfterMinutes)],
    );

    const queuedSpotIds: string[] = [];
    const skippedSpotIds: string[] = [];
    const errors: Array<{ spotId: string; message: string }> = [];
    const concurrency = 5;

    for (let index = 0; index < failedSpots.length; index += concurrency) {
      const batch = failedSpots.slice(index, index + concurrency);
      const results = await Promise.all(
        batch.map(async (spot: { id: string }) => {
          try {
            await this.retryFailedSpot(spot.id);
            queuedSpotIds.push(spot.id);
          } catch (error) {
            skippedSpotIds.push(spot.id);
            errors.push({
              spotId: spot.id,
              message: error instanceof Error ? error.message : 'Retry failed',
            });
          }
        }),
      );

      void results;
    }

    return {
      requested: failedSpots.length,
      retried: queuedSpotIds.length,
      skipped: skippedSpotIds.length,
      queuedSpotIds,
      skippedSpotIds,
      errors,
    };
  }

  private async getWorkerOpsState(): Promise<WorkerOpsState | null> {
    try {
      const raw = await this.redisClient.get(this.workerOpsKey);
      return raw ? (JSON.parse(raw) as WorkerOpsState) : null;
    } catch {
      return null;
    }
  }

  private async getQueueSummary() {
    const counts = await this.detectionQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'paused');

    return {
      name: this.queueName,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        paused: counts.paused ?? 0,
      },
    };
  }

  private async getRecentFailedJobs(limit: number) {
    const jobs = await this.detectionQueue.getJobs(['failed'], 0, Math.max(limit - 1, 0), false);
    return jobs.map((job) => ({
      jobId: job.id,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      attemptsMade: job.attemptsMade,
      error: job.failedReason || null,
    }));
  }

  private async getSpotSummary() {
    const [countRows, oldestQueuedRow, oldestProcessingRow, stalledRow] = await Promise.all([
      this.spotRepository.query(
        `
          SELECT processing_status, COUNT(*)::int AS count
          FROM spots
          GROUP BY processing_status
        `,
      ),
      this.spotRepository.query(
        `
          SELECT MIN(created_at) AS oldest_queued_at
          FROM spots
          WHERE processing_status = 'queued'
        `,
      ),
      this.spotRepository.query(
        `
          SELECT MIN(detection_started_at) AS oldest_processing_at
          FROM spots
          WHERE processing_status = 'processing'
        `,
      ),
      // Counted separately from `queued`/`processing` because these are the ones
      // the retry sweep can actually rescue, and the UI gates its retry control on
      // this. A plain queued count would light the button up for spots that are
      // simply in flight.
      this.spotRepository.query(
        `
          SELECT COUNT(*)::int AS stalled
          FROM spots
          WHERE processing_status IN ('queued', 'processing')
            AND updated_at < NOW() - ($1 || ' minutes')::interval
        `,
        [String(this.stalledAfterMinutes)],
      ),
    ]);

    const counts = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const row of countRows as Array<{ processing_status: keyof typeof counts; count: number }>) {
      if (row.processing_status in counts) {
        counts[row.processing_status] = Number(row.count);
      }
    }

    return {
      counts,
      stalled: Number(stalledRow[0]?.stalled ?? 0),
      oldestQueuedAgeSeconds: this.toAgeSeconds(oldestQueuedRow[0]?.oldest_queued_at),
      oldestProcessingAgeSeconds: this.toAgeSeconds(oldestProcessingRow[0]?.oldest_processing_at),
    };
  }

  private async getWorkerSummary() {
    const rawState = await this.redisClient.get(this.workerOpsKey);
    if (!rawState) {
      return {
        name: this.queueName,
        healthy: false,
        lastHeartbeatAt: null,
        lastJobStartedAt: null,
        lastJobCompletedAt: null,
        lastJobFailedAt: null,
        concurrency: null,
        hostname: null,
        pid: null,
        lastFailedError: null,
      };
    }

    try {
      const parsed = JSON.parse(rawState) as WorkerOpsState;
      const healthy = this.isWorkerHeartbeatFresh(parsed.lastHeartbeatAt);

      return {
        name: parsed.name || this.queueName,
        healthy,
        lastHeartbeatAt: parsed.lastHeartbeatAt || null,
        lastJobStartedAt: parsed.lastJobStartedAt || null,
        lastJobCompletedAt: parsed.lastJobCompletedAt || null,
        lastJobFailedAt: parsed.lastJobFailedAt || null,
        concurrency: parsed.concurrency ?? null,
        hostname: parsed.hostname || null,
        pid: parsed.pid ?? null,
        lastFailedError: parsed.lastFailedError || null,
      };
    } catch {
      return {
        name: this.queueName,
        healthy: false,
        lastHeartbeatAt: null,
        lastJobStartedAt: null,
        lastJobCompletedAt: null,
        lastJobFailedAt: null,
        concurrency: null,
        hostname: null,
        pid: null,
        lastFailedError: null,
      };
    }
  }

  private async checkPostgres() {
    const startedAt = Date.now();
    try {
      await this.spotRepository.query('SELECT 1');
      return { status: 'ok' as const, latencyMs: Date.now() - startedAt };
    } catch {
      return { status: 'down' as const, latencyMs: Date.now() - startedAt };
    }
  }

  private async checkRedis() {
    const startedAt = Date.now();
    try {
      await this.redisClient.ping();
      return { status: 'ok' as const, latencyMs: Date.now() - startedAt };
    } catch {
      return { status: 'down' as const, latencyMs: Date.now() - startedAt };
    }
  }

  private async checkMinio() {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      return { status: 'ok' as const, bucket: this.bucketName };
    } catch {
      return { status: 'down' as const, bucket: this.bucketName };
    }
  }

  private isWorkerHeartbeatFresh(lastHeartbeatAt?: string) {
    if (!lastHeartbeatAt) {
      return false;
    }

    const ageSeconds = this.toAgeSeconds(lastHeartbeatAt);
    return ageSeconds !== null && ageSeconds <= this.workerHeartbeatTtlSeconds;
  }

  private toAgeSeconds(timestamp: string | Date | null | undefined) {
    if (!timestamp) {
      return null;
    }

    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  }

  private getOverallHealthStatus(failedJobs: number, workerHealthy: boolean): HealthStatus {
    if (!workerHealthy || failedJobs > 0) {
      return 'degraded';
    }

    return 'ok';
  }

  async getStorageInsights() {
    const [summary, growthRate] = await Promise.all([
      this.storageService.getStorageSummary(),
      this.storageService.getGrowthRate(8),
    ]);

    return {
      timestamp: new Date().toISOString(),
      ...summary,
      growthRate,
    };
  }

  async getPurgeStatus() {
    const status = await this.purgeService.getPurgeStatus();
    return {
      timestamp: new Date().toISOString(),
      ...status,
    };
  }

  async getSpotAggregateStats() {
    const [countRows, topObjects, topMaterials] = await Promise.all([
      this.spotRepository.query(
        `SELECT processing_status, COUNT(*)::int AS count FROM spots GROUP BY processing_status`,
      ),
      this.detectedItemRepository.query(
        `SELECT lt.name AS object, COUNT(*)::int AS count
         FROM detected_items di
         JOIN labels l ON l.id = di.object_label_id
         JOIN label_translations lt ON lt.label_id = l.id AND lt.locale = 'en'
         GROUP BY lt.name ORDER BY count DESC LIMIT 10`,
      ),
      this.detectedItemRepository.query(
        `SELECT lt.name AS material, COUNT(*)::int AS count
         FROM detected_items di
         JOIN labels l ON l.id = di.material_label_id
         JOIN label_translations lt ON lt.label_id = l.id AND lt.locale = 'en'
         GROUP BY lt.name ORDER BY count DESC LIMIT 10`,
      ),
    ]);

    const byStatus = { queued: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of countRows as Array<{ processing_status: keyof typeof byStatus; count: number }>) {
      if (row.processing_status in byStatus) {
        byStatus[row.processing_status] = Number(row.count);
      }
    }

    const total = byStatus.completed + byStatus.failed;
    const successRate = total > 0 ? byStatus.completed / total : 0;

    return {
      timestamp: new Date().toISOString(),
      byStatus,
      successRate,
      topObjects: (topObjects as Array<{ object: string; count: number }>).map((r) => ({
        object: r.object,
        count: Number(r.count),
      })),
      topMaterials: (topMaterials as Array<{ material: string; count: number }>).map((r) => ({
        material: r.material,
        count: Number(r.count),
      })),
    };
  }

  async deleteSpot(spotId: string): Promise<void> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId } });
    if (!spot) throw new NotFoundException('Spot not found');

    this.logger.log(
      `Admin deleting spot ${spot.id}: user=${spot.user_id}, captured_at=${spot.captured_at.toISOString()}`,
    );

    const keysToDelete = [spot.image_key, spot.thumbnail_key].filter(Boolean) as string[];
    for (const key of keysToDelete) {
      try {
        await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
      } catch (error) {
        this.logger.warn(`Failed to delete S3 object ${key} for spot ${spot.id}: ${error.message}`);
      }
    }

    await this.spotRepository.remove(spot);
  }

  private isStalled(spot: Spot): boolean {
    if (spot.processing_status !== PROCESSING_STATUS.QUEUED && spot.processing_status !== PROCESSING_STATUS.PROCESSING) {
      return false;
    }

    const updatedAt = spot.updated_at instanceof Date ? spot.updated_at.getTime() : Date.parse(String(spot.updated_at));
    return Number.isFinite(updatedAt) && Date.now() - updatedAt > this.stalledAfterMinutes * 60_000;
  }

  private async retryFailedSpot(spotId: string): Promise<void> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId } });
    if (!spot) {
      throw new Error('Spot not found');
    }

    if (spot.processing_status !== PROCESSING_STATUS.FAILED && !this.isStalled(spot)) {
      throw new Error('Only failed or stalled spots can be retried');
    }

    // No image means no detection is possible, ever. Re-enqueueing would just
    // produce 'Invalid job payload' on every sweep, forever.
    if (!spot.image_key) {
      throw new Error('Spot has no stored image and can never be processed');
    }

    spot.processing_status = PROCESSING_STATUS.QUEUED;
    spot.processing_error = null;
    spot.detection_started_at = null;
    await this.spotRepository.save(spot);

    const existingJob = await this.detectionQueue.getJob(spot.id);
    if (existingJob) {
      await existingJob.retry();
      return;
    }

    // Must mirror the original enqueue in SpotService.create: a plant spot needs
    // the identify-plant job and its subjectKind, or the retry quietly runs litter
    // detection over a photo of a plant.
    await this.detectionQueue.add(
      spot.subject_kind === 'plant' ? 'identify-plant' : 'detect-litter',
      {
        spotId: spot.id,
        userId: spot.user_id,
        imageKey: spot.image_key,
        mimeType: spot.mime_type,
        subjectKind: spot.subject_kind,
      },
      {
        jobId: spot.id,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
