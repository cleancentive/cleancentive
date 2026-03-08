import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CleanupReport } from '../cleanup/cleanup-report.entity';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

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
}

@Injectable()
export class AdminOpsService implements OnModuleDestroy {
  private readonly queueName = process.env.ANALYSIS_QUEUE_NAME || 'image-analysis';
  private readonly workerOpsKey = `ops:worker:${this.queueName}`;
  private readonly workerHeartbeatTtlSeconds = 30;
  private readonly bucketName = process.env.S3_BUCKET || 'cleancentive-images';
  private readonly analysisQueue: Queue;
  private readonly redisClient: Redis;
  private readonly s3Client: S3Client;

  constructor(
    @InjectRepository(CleanupReport)
    private readonly reportRepository: Repository<CleanupReport>,
  ) {
    const redisConnection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };

    this.analysisQueue = new Queue(this.queueName, {
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
    await this.analysisQueue.close();
    await this.redisClient.quit();
  }

  async getOverview() {
    const [queue, reports, worker] = await Promise.all([
      this.getQueueSummary(),
      this.getReportSummary(),
      this.getWorkerSummary(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      health: {
        status: this.getOverallHealthStatus(queue.counts.failed, worker.healthy),
      },
      queue,
      reports,
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

  async getReports(failureLimit: number) {
    const reports = await this.getReportSummary();
    const recentFailures = await this.reportRepository.query(
      `
        SELECT id, user_id, updated_at, processing_error
        FROM cleanup_reports
        WHERE processing_status = 'failed'
        ORDER BY updated_at DESC
        LIMIT $1
      `,
      [failureLimit],
    );

    return {
      timestamp: new Date().toISOString(),
      reports: {
        ...reports,
        recentFailures: recentFailures.map((failure: Record<string, unknown>) => ({
          reportId: failure.id,
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

  async retryFailedReports(limit: number) {
    const failedReports = await this.reportRepository.query(
      `
        SELECT id
        FROM cleanup_reports
        WHERE processing_status = 'failed'
        ORDER BY updated_at ASC
        LIMIT $1
      `,
      [limit],
    );

    const queuedReportIds: string[] = [];
    const skippedReportIds: string[] = [];
    const errors: Array<{ reportId: string; message: string }> = [];
    const concurrency = 5;

    for (let index = 0; index < failedReports.length; index += concurrency) {
      const batch = failedReports.slice(index, index + concurrency);
      const results = await Promise.all(
        batch.map(async (report: { id: string }) => {
          try {
            await this.retryFailedReport(report.id);
            queuedReportIds.push(report.id);
          } catch (error) {
            skippedReportIds.push(report.id);
            errors.push({
              reportId: report.id,
              message: error instanceof Error ? error.message : 'Retry failed',
            });
          }
        }),
      );

      void results;
    }

    return {
      requested: failedReports.length,
      retried: queuedReportIds.length,
      skipped: skippedReportIds.length,
      queuedReportIds,
      skippedReportIds,
      errors,
    };
  }

  private async getQueueSummary() {
    const counts = await this.analysisQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'paused');

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
    const jobs = await this.analysisQueue.getJobs(['failed'], 0, Math.max(limit - 1, 0), false);
    return jobs.map((job) => ({
      jobId: job.id,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      attemptsMade: job.attemptsMade,
      error: job.failedReason || null,
    }));
  }

  private async getReportSummary() {
    const [countRows, oldestQueuedRow, oldestProcessingRow] = await Promise.all([
      this.reportRepository.query(
        `
          SELECT processing_status, COUNT(*)::int AS count
          FROM cleanup_reports
          GROUP BY processing_status
        `,
      ),
      this.reportRepository.query(
        `
          SELECT MIN(created_at) AS oldest_queued_at
          FROM cleanup_reports
          WHERE processing_status = 'queued'
        `,
      ),
      this.reportRepository.query(
        `
          SELECT MIN(analysis_started_at) AS oldest_processing_at
          FROM cleanup_reports
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
      await this.reportRepository.query('SELECT 1');
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

  private async retryFailedReport(reportId: string): Promise<void> {
    const report = await this.reportRepository.findOne({ where: { id: reportId } });
    if (!report) {
      throw new Error('Report not found');
    }

    if (report.processing_status !== 'failed') {
      throw new Error('Only failed reports can be retried');
    }

    report.processing_status = 'queued';
    report.processing_error = null;
    report.analysis_started_at = null;
    report.updated_by = report.user_id;
    await this.reportRepository.save(report);

    const existingJob = await this.analysisQueue.getJob(report.id);
    if (existingJob) {
      await existingJob.retry();
      return;
    }

    await this.analysisQueue.add(
      'analyze-upload',
      {
        reportId: report.id,
        userId: report.user_id,
        imageKey: report.image_key,
        mimeType: report.mime_type,
      },
      {
        jobId: report.id,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
