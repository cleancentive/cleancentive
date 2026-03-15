import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Spot } from './spot.entity';
import { TeamService } from '../team/team.service';
import { CleanupService } from '../cleanup/cleanup.service';

interface CreateSpotInput {
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

interface CreateSpotResult {
  spot: Spot;
  warning: string | null;
}

@Injectable()
export class SpotService {
  private readonly queueName = process.env.DETECTION_QUEUE_NAME || 'litter-detection';
  private readonly bucketName = process.env.S3_BUCKET || 'cleancentive-images';
  private readonly detectionQueue: Queue;
  private readonly s3Client: S3Client;
  private bucketReady = false;

  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
    private readonly teamService: TeamService,
    private readonly cleanupService: CleanupService,
  ) {
    this.detectionQueue = new Queue(this.queueName, {
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

  async createSpot(input: CreateSpotInput): Promise<CreateSpotResult> {
    const existing = await this.spotRepository.findOne({
      where: {
        upload_id: input.uploadId,
        user_id: input.userId,
      },
    });

    if (existing) {
      return { spot: existing, warning: null };
    }

    await this.ensureBucketExists();

    const fileExt = this.getFileExtension(input.mimeType);

    const activeTeam = await this.teamService.resolveActiveTeamForUser(input.userId);
    const activeCleanup = await this.cleanupService.resolveActiveCleanupDateForSpot(
      input.userId,
      input.latitude,
      input.longitude,
    );

    const spot = this.spotRepository.create({
      user_id: input.userId,
      team_id: activeTeam?.id || null,
      cleanup_id: activeCleanup.cleanupId,
      cleanup_date_id: activeCleanup.cleanupDateId,
      latitude: input.latitude,
      longitude: input.longitude,
      location_accuracy_meters: input.accuracyMeters,
      captured_at: input.capturedAt,
      mime_type: input.mimeType,
      image_key: '',
      thumbnail_key: null,
      upload_id: input.uploadId,
      processing_status: 'queued',
    });

    const savedSpot = await this.spotRepository.save(spot);

    const imageKey = `spots/${savedSpot.id}/original-${savedSpot.upload_id}.${fileExt}`;
    const thumbnailKey = input.thumbnailBuffer
      ? `spots/${savedSpot.id}/thumbnail-${savedSpot.upload_id}.jpg`
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

    savedSpot.image_key = imageKey;
    savedSpot.thumbnail_key = thumbnailKey;
    await this.spotRepository.save(savedSpot);

    try {
      await this.detectionQueue.add(
        'detect-litter',
        {
          spotId: savedSpot.id,
          userId: savedSpot.user_id,
          imageKey: savedSpot.image_key,
          mimeType: savedSpot.mime_type,
        },
        {
          jobId: savedSpot.id,
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
      savedSpot.processing_status = 'failed';
      savedSpot.processing_error = 'Failed to enqueue litter detection job';
      await this.spotRepository.save(savedSpot);

      throw new ServiceUnavailableException('Spot accepted but detection queue is unavailable');
    }

    return {
      spot: savedSpot,
      warning: activeCleanup.warning,
    };
  }

  async getSpotStatus(spotId: string, userId: string): Promise<Spot> {
    const spot = await this.spotRepository.findOne({
      where: {
        id: spotId,
        user_id: userId,
      },
      relations: ['items'],
    });

    if (!spot) {
      throw new NotFoundException('Spot not found');
    }

    return spot;
  }

  async getSpotStatusForGuest(spotId: string, guestId: string): Promise<Spot> {
    const spot = await this.spotRepository.findOne({
      where: {
        id: spotId,
        user_id: guestId,
      },
      relations: ['items'],
    });

    if (!spot) {
      throw new NotFoundException('Spot not found');
    }

    return spot;
  }

  async listSpotsForUser(userId: string, limit: number): Promise<Spot[]> {
    return this.spotRepository.find({
      where: { user_id: userId },
      relations: ['items'],
      order: { captured_at: 'DESC' },
      take: limit,
    });
  }

  async listSpotsForGuest(guestId: string, limit: number): Promise<Spot[]> {
    return this.spotRepository.find({
      where: { user_id: guestId },
      relations: ['items'],
      order: { captured_at: 'DESC' },
      take: limit,
    });
  }

  async getThumbnailStream(spotId: string): Promise<{ body: NodeJS.ReadableStream; contentType: string } | null> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId } });
    if (!spot?.thumbnail_key) return null;

    const result = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: spot.thumbnail_key }),
    );

    if (!result.Body) return null;
    return { body: result.Body as NodeJS.ReadableStream, contentType: 'image/jpeg' };
  }

  async retryDetection(spotId: string, userId: string): Promise<void> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId, user_id: userId } });
    if (!spot) throw new NotFoundException('Spot not found');
    await this.retryFailedSpot(spot, userId);
  }

  async retryDetectionAsAdmin(spotId: string): Promise<void> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId } });
    if (!spot) throw new NotFoundException('Spot not found');
    await this.retryFailedSpot(spot, spot.user_id);
  }

  async close(): Promise<void> {
    await this.detectionQueue.close();
  }

  private async retryFailedSpot(spot: Spot, updatedBy: string): Promise<void> {
    if (spot.processing_status !== 'failed') throw new BadRequestException('Only failed spots can be retried');

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
      { spotId: spot.id, userId: spot.user_id, imageKey: spot.image_key, mimeType: spot.mime_type },
      { jobId: spot.id, attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false },
    );
  }
}
