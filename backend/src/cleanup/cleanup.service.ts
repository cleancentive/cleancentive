import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { CleanupReport } from './cleanup-report.entity';

interface CreateUploadInput {
  userId: string;
  uploadId: string;
  imageBuffer: Buffer;
  thumbnailBuffer: Buffer | null;
  mimeType: string;
  capturedAt: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

@Injectable()
export class CleanupService {
  private readonly queueName = process.env.ANALYSIS_QUEUE_NAME || 'image-analysis';
  private readonly bucketName = process.env.S3_BUCKET || 'cleancentive-images';
  private readonly analysisQueue: Queue;
  private readonly s3Client: S3Client;
  private bucketReady = false;

  constructor(
    @InjectRepository(CleanupReport)
    private readonly reportRepository: Repository<CleanupReport>,
  ) {
    this.analysisQueue = new Queue(this.queueName, {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    });

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

  private getFileExtension(mimeType: string): string {
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    return 'jpg';
  }

  private async ensureBucketExists(): Promise<void> {
    if (this.bucketReady) {
      return;
    }

    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
    } catch {
      try {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
      } catch {
        throw new ServiceUnavailableException(
          'Object storage unavailable. Check S3 endpoint and MinIO service availability.',
        );
      }
    }

    this.bucketReady = true;
  }

  async createUpload(input: CreateUploadInput): Promise<CleanupReport> {
    const existing = await this.reportRepository.findOne({
      where: {
        upload_id: input.uploadId,
        user_id: input.userId,
      },
    });

    if (existing) {
      return existing;
    }

    await this.ensureBucketExists();

    const fileExt = this.getFileExtension(input.mimeType);

    const report = this.reportRepository.create({
      user_id: input.userId,
      latitude: input.latitude,
      longitude: input.longitude,
      location_accuracy_meters: input.accuracyMeters,
      captured_at: input.capturedAt,
      mime_type: input.mimeType,
      image_key: '',
      thumbnail_key: null,
      upload_id: input.uploadId,
      processing_status: 'queued',
      created_by: input.userId,
      updated_by: input.userId,
    });

    const savedReport = await this.reportRepository.save(report);

    const imageKey = `reports/${savedReport.id}/original-${savedReport.upload_id}.${fileExt}`;
    const thumbnailKey = input.thumbnailBuffer
      ? `reports/${savedReport.id}/thumbnail-${savedReport.upload_id}.jpg`
      : null;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: imageKey,
          Body: input.imageBuffer,
          ContentType: input.mimeType,
        }),
      );
    } catch {
      throw new ServiceUnavailableException(
        'Failed to store image in object storage. Check MinIO connectivity and configuration.',
      );
    }

    if (thumbnailKey && input.thumbnailBuffer) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: thumbnailKey,
            Body: input.thumbnailBuffer,
            ContentType: 'image/jpeg',
          }),
        );
      } catch {
        throw new ServiceUnavailableException(
          'Failed to store thumbnail in object storage. Check MinIO connectivity and configuration.',
        );
      }
    }

    savedReport.image_key = imageKey;
    savedReport.thumbnail_key = thumbnailKey;
    await this.reportRepository.save(savedReport);

    try {
      await this.analysisQueue.add(
        'analyze-upload',
        {
          reportId: savedReport.id,
          userId: savedReport.user_id,
          imageKey: savedReport.image_key,
          mimeType: savedReport.mime_type,
        },
        {
          jobId: savedReport.id,
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch {
      savedReport.processing_status = 'failed';
      savedReport.processing_error = 'Failed to enqueue image analysis job';
      savedReport.updated_by = savedReport.user_id;
      await this.reportRepository.save(savedReport);

      throw new ServiceUnavailableException('Image upload accepted but analysis queue is unavailable');
    }

    return savedReport;
  }

  async getUploadStatus(reportId: string, userId: string): Promise<CleanupReport> {
    const report = await this.reportRepository.findOne({
      where: {
        id: reportId,
        user_id: userId,
      },
      relations: ['items'],
    });

    if (!report) {
      throw new NotFoundException('Upload not found');
    }

    return report;
  }

  async getUploadStatusForGuest(reportId: string, guestId: string): Promise<CleanupReport> {
    const report = await this.reportRepository.findOne({
      where: {
        id: reportId,
        user_id: guestId,
      },
      relations: ['items'],
    });

    if (!report) {
      throw new NotFoundException('Upload not found');
    }

    return report;
  }

  async listUploadsForUser(userId: string, limit: number): Promise<CleanupReport[]> {
    return this.reportRepository.find({
      where: { user_id: userId },
      relations: ['items'],
      order: { captured_at: 'DESC' },
      take: limit,
    });
  }

  async listUploadsForGuest(guestId: string, limit: number): Promise<CleanupReport[]> {
    return this.reportRepository.find({
      where: { user_id: guestId },
      relations: ['items'],
      order: { captured_at: 'DESC' },
      take: limit,
    });
  }

  async getThumbnailStream(reportId: string): Promise<{ body: NodeJS.ReadableStream; contentType: string } | null> {
    const report = await this.reportRepository.findOne({ where: { id: reportId } });
    if (!report?.thumbnail_key) return null;

    const result = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: report.thumbnail_key }),
    );

    if (!result.Body) return null;
    return { body: result.Body as NodeJS.ReadableStream, contentType: 'image/jpeg' };
  }

  async close(): Promise<void> {
    await this.analysisQueue.close();
  }
}
