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

const pkg = require(require('path').join(process.cwd(), 'package.json'));

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
  version?: string;
  buildTime?: number;
}

@Injectable()
export class AdminOpsService implements OnModuleDestroy {
  private readonly logger = new Logger(AdminOpsService.name);
  private readonly queueName = process.env.DETECTION_QUEUE_NAME || 'litter-detection';
  private readonly workerOpsKey = `ops:worker:${this.queueName}`;
  private readonly workerHeartbeatTtlSeconds = 30;
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
    const redisConnection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };

    this.detectionQueue = new Queue(this.queueName, {
      connection: redisConnection,
    });

    this.redisClient = new Redis(redisConnection);

    this.s3Client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9002',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
      },
    });
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

  async retryFailedSpots(limit: number) {
    const failedSpots = await this.spotRepository.query(
      `
        SELECT id
        FROM spots
        WHERE processing_status = 'failed'
        ORDER BY updated_at ASC
        LIMIT $1
      `,
      [limit],
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

  async getVersion() {
    const workerState = await this.getWorkerOpsState();
    return {
      backend: {
        version: pkg.version || 'unknown',
        buildTime: pkg.buildTime ?? 0,
      },
      worker: workerState
        ? { version: workerState.version || 'unknown', buildTime: workerState.buildTime ?? 0 }
        : null,
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
    const [countRows, oldestQueuedRow, oldestProcessingRow] = await Promise.all([
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

  private async retryFailedSpot(spotId: string): Promise<void> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId } });
    if (!spot) {
      throw new Error('Spot not found');
    }

    if (spot.processing_status !== 'failed') {
      throw new Error('Only failed spots can be retried');
    }

    spot.processing_status = 'queued';
    spot.processing_error = null;
    spot.detection_started_at = null;
    await this.spotRepository.save(spot);

    const existingJob = await this.detectionQueue.getJob(spot.id);
    if (existingJob) {
      await existingJob.retry();
      return;
    }

    await this.detectionQueue.add(
      'detect-litter',
      {
        spotId: spot.id,
        userId: spot.user_id,
        imageKey: spot.image_key,
        mimeType: spot.mime_type,
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
