import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Spot } from '../spot/spot.entity';
import { EmailService } from '../email/email.service';
import { AdminService } from '../admin/admin.service';

interface StorageSummary {
  totalBytes: number;
  totalOriginalBytes: number;
  totalThumbnailBytes: number;
  spotCount: number;
}

interface GrowthEntry {
  week: string;
  bytes: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly redis: Redis;
  private readonly warningKey = 'storage:warning:sent';
  private readonly warningTtlSeconds = 86400; // 24 hours

  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
    private readonly emailService: EmailService,
    private readonly adminService: AdminService,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  async getStorageSummary(): Promise<StorageSummary> {
    const result = await this.spotRepository
      .createQueryBuilder('spot')
      .select('COALESCE(SUM(CASE WHEN spot.original_purged_at IS NULL THEN spot.original_size_bytes ELSE 0 END), 0)', 'totalOriginalBytes')
      .addSelect('COALESCE(SUM(spot.thumbnail_size_bytes), 0)', 'totalThumbnailBytes')
      .addSelect('COUNT(*)', 'spotCount')
      .getRawOne();

    const totalOriginalBytes = Number(result.totalOriginalBytes);
    const totalThumbnailBytes = Number(result.totalThumbnailBytes);

    return {
      totalBytes: totalOriginalBytes + totalThumbnailBytes,
      totalOriginalBytes,
      totalThumbnailBytes,
      spotCount: Number(result.spotCount),
    };
  }

  async getGrowthRate(weeks: number = 8): Promise<GrowthEntry[]> {
    const result = await this.spotRepository
      .createQueryBuilder('spot')
      .select("TO_CHAR(date_trunc('week', spot.created_at), 'YYYY-MM-DD')", 'week')
      .addSelect('COALESCE(SUM(spot.original_size_bytes + spot.thumbnail_size_bytes), 0)', 'bytes')
      .where("spot.created_at >= NOW() - MAKE_INTERVAL(weeks => :weeks)", { weeks })
      .groupBy("date_trunc('week', spot.created_at)")
      .orderBy("date_trunc('week', spot.created_at)", 'ASC')
      .getRawMany();

    return result.map((row) => ({
      week: row.week,
      bytes: Number(row.bytes),
    }));
  }

  async checkAndSendWarning(): Promise<void> {
    const thresholdGb = parseFloat(process.env.STORAGE_WARNING_THRESHOLD_GB || '');
    if (!thresholdGb || thresholdGb <= 0) return;

    const thresholdBytes = thresholdGb * 1024 * 1024 * 1024;
    const summary = await this.getStorageSummary();

    if (summary.totalBytes < thresholdBytes) return;

    const alreadySent = await this.redis.get(this.warningKey);
    if (alreadySent) return;

    const adminEmails = this.adminService.getAdminEmails();
    if (adminEmails.length === 0) {
      this.logger.warn('Storage threshold exceeded but no admin emails configured');
      return;
    }

    const totalGb = (summary.totalBytes / (1024 * 1024 * 1024)).toFixed(2);

    await this.emailService.sendCommunityMessage(
      adminEmails,
      null,
      {
        subject: `Storage Warning: Cleancentive has exceeded ${thresholdGb}GB`,
        preheader: `Total storage is now ${totalGb}GB`,
        title: 'Storage Threshold Exceeded',
        body: `Total storage volume has reached ${totalGb}GB, exceeding the configured threshold of ${thresholdGb}GB.\n\nOriginals: ${this.formatBytes(summary.totalOriginalBytes)}\nThumbnails: ${this.formatBytes(summary.totalThumbnailBytes)}\nTotal spots: ${summary.spotCount}`,
        disclosure: 'This is an automated system notification sent to Cleancentive administrators.',
      },
    );

    await this.redis.set(this.warningKey, '1', 'EX', this.warningTtlSeconds);
    this.logger.log(`Storage warning sent to ${adminEmails.length} admin(s). Total: ${totalGb}GB`);
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }
}
