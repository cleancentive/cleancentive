import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { Queue, Worker } from 'bullmq';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import { Spot } from '../spot/spot.entity';
import { StorageService } from '../storage/storage.service';

interface PurgeStatus {
  enabled: boolean;
  retentionDays: number | null;
  lastRunAt: string | null;
  totalFreedBytes: number;
  lastFreedBytes: number;
  lastSpotsPurged: number;
  nextRunAt: string | null;
  estimatedPurgeBytes: number;
  estimatedPurgeCount: number;
}

@Injectable()
export class PurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurgeService.name);
  private readonly queueName = 'cleancentive-purge';
  private readonly bucketName = process.env.S3_BUCKET || 'cleancentive-images';
  private queue: Queue;
  private worker: Worker;
  private readonly redis: Redis;
  private readonly s3Client: S3Client;

  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
    private readonly storageService: StorageService,
  ) {
    const redisConnection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };

    this.redis = new Redis(redisConnection);

    this.s3Client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9002',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
      },
    });

    this.queue = new Queue(this.queueName, { connection: redisConnection });
    this.worker = new Worker(
      this.queueName,
      async (job) => {
        switch (job.name) {
          case 'purge-originals':
            await this.deleteExpiredOriginals();
            break;
          case 'storage-warning-check':
            await this.storageService.checkAndSendWarning();
            break;
        }
      },
      { connection: redisConnection, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Purge job ${job?.name} failed: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    const retentionDays = this.getRetentionDays();
    if (retentionDays !== null) {
      await this.queue.add('purge-originals', {}, {
        repeat: { pattern: '0 3 * * *' },
        removeOnComplete: true,
        removeOnFail: false,
      });
      this.logger.log(`Image purge enabled: retention ${retentionDays} days, daily at 3 AM`);
    } else {
      this.logger.log('Image purge disabled (IMAGE_PURGE_RETENTION_DAYS not set)');
    }

    await this.queue.add('storage-warning-check', {}, {
      repeat: { pattern: '0 4 * * *' },
      removeOnComplete: true,
      removeOnFail: false,
    });
    this.logger.log('Storage warning check registered: daily at 4 AM');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.redis?.disconnect();
  }

  async getPurgeStatus(): Promise<PurgeStatus> {
    const retentionDays = this.getRetentionDays();
    const enabled = retentionDays !== null;

    const [lastRunAt, totalFreedBytes, lastFreedBytes, lastSpotsPurged] = await Promise.all([
      this.redis.get('purge:last_run_at'),
      this.redis.get('purge:total_freed_bytes'),
      this.redis.get('purge:last_freed_bytes'),
      this.redis.get('purge:last_spots_purged'),
    ]);

    let nextRunAt: string | null = null;
    const repeatables = await this.queue.getRepeatableJobs();
    const purgeJob = repeatables.find((j) => j.name === 'purge-originals');
    if (purgeJob?.next) {
      nextRunAt = new Date(purgeJob.next).toISOString();
    }

    let estimatedPurgeBytes = 0;
    let estimatedPurgeCount = 0;

    if (enabled) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);

      const estimate = await this.spotRepository
        .createQueryBuilder('spot')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(spot.original_size_bytes), 0)', 'bytes')
        .where('spot.original_purged_at IS NULL')
        .andWhere('spot.captured_at < :cutoff', { cutoff })
        .getRawOne();

      estimatedPurgeCount = Number(estimate.count);
      estimatedPurgeBytes = Number(estimate.bytes);
    }

    return {
      enabled,
      retentionDays,
      lastRunAt,
      totalFreedBytes: Number(totalFreedBytes || 0),
      lastFreedBytes: Number(lastFreedBytes || 0),
      lastSpotsPurged: Number(lastSpotsPurged || 0),
      nextRunAt,
      estimatedPurgeBytes,
      estimatedPurgeCount,
    };
  }

  private getRetentionDays(): number | null {
    const raw = process.env.IMAGE_PURGE_RETENTION_DAYS;
    if (!raw) return null;
    const days = parseInt(raw, 10);
    if (isNaN(days) || days <= 0) return null;
    return days;
  }

  private async deleteExpiredOriginals(): Promise<void> {
    const retentionDays = this.getRetentionDays();
    if (retentionDays === null) {
      this.logger.log('Purge skipped: IMAGE_PURGE_RETENTION_DAYS not set or invalid');
      return;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const spots = await this.spotRepository.find({
      where: {
        original_purged_at: IsNull(),
        captured_at: LessThan(cutoff),
      },
      take: 100,
      order: { captured_at: 'ASC' },
    });

    if (spots.length === 0) {
      this.logger.log('Purge: no eligible spots found');
      await this.updateStats(0, 0);
      return;
    }

    let freedBytes = 0;
    let purgedCount = 0;

    for (const spot of spots) {
      try {
        await this.s3Client.send(
          new DeleteObjectCommand({ Bucket: this.bucketName, Key: spot.image_key }),
        );
        freedBytes += Number(spot.original_size_bytes);
        spot.original_purged_at = new Date();
        await this.spotRepository.save(spot);
        purgedCount++;
      } catch (error) {
        this.logger.error(`Failed to purge original for spot ${spot.id}: ${error.message}`);
      }
    }

    await this.updateStats(freedBytes, purgedCount);
    this.logger.log(`Purge complete: ${purgedCount} originals deleted, ${this.formatBytes(freedBytes)} freed`);
  }

  private async updateStats(freedBytes: number, purgedCount: number): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.set('purge:last_run_at', new Date().toISOString());
    pipeline.set('purge:last_freed_bytes', freedBytes.toString());
    pipeline.set('purge:last_spots_purged', purgedCount.toString());
    if (freedBytes > 0) {
      pipeline.incrby('purge:total_freed_bytes', freedBytes);
    }
    await pipeline.exec();
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }
}
