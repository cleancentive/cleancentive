import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Spot } from './spot.entity';
import { DetectedItem } from './detected-item.entity';
import { DetectedItemEdit } from './detected-item-edit.entity';
import { TeamService } from '../team/team.service';
import { CleanupService } from '../cleanup/cleanup.service';
import { LabelService } from '../label/label.service';

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
  pickedUp?: boolean;
  cleanupId?: string | null;
  cleanupDateId?: string | null;
}

interface CreateSpotResult {
  spot: Spot;
  warning: string | null;
}

@Injectable()
export class SpotService {
  private readonly logger = new Logger(SpotService.name);
  private readonly queueName = process.env.DETECTION_QUEUE_NAME || 'litter-detection';
  private readonly bucketName = process.env.S3_BUCKET || 'cleancentive-images';
  private readonly detectionQueue: Queue;
  private readonly s3Client: S3Client;
  private bucketReady = false;

  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
    @InjectRepository(DetectedItem)
    private readonly detectedItemRepository: Repository<DetectedItem>,
    @InjectRepository(DetectedItemEdit)
    private readonly detectedItemEditRepository: Repository<DetectedItemEdit>,
    private readonly dataSource: DataSource,
    private readonly teamService: TeamService,
    private readonly cleanupService: CleanupService,
    private readonly labelService: LabelService,
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

    let resolvedCleanupId: string | null = null;
    let resolvedCleanupDateId: string | null = null;
    let warning: string | null = null;

    if (input.cleanupId && input.cleanupDateId) {
      const validation = await this.cleanupService.validateExplicitCleanupAssociation(
        input.userId,
        input.cleanupId,
        input.cleanupDateId,
        input.capturedAt,
      );
      if (validation.valid) {
        resolvedCleanupId = input.cleanupId;
        resolvedCleanupDateId = input.cleanupDateId;
      } else {
        warning = validation.warning;
      }
    } else {
      const activeCleanup = await this.cleanupService.resolveActiveCleanupDateForSpot(
        input.userId,
        input.latitude,
        input.longitude,
      );
      resolvedCleanupId = activeCleanup.cleanupId;
      resolvedCleanupDateId = activeCleanup.cleanupDateId;
      warning = activeCleanup.warning;
    }

    const spot = this.spotRepository.create({
      user_id: input.userId,
      team_id: activeTeam?.id || null,
      cleanup_id: resolvedCleanupId,
      cleanup_date_id: resolvedCleanupDateId,
      latitude: input.latitude,
      longitude: input.longitude,
      location_accuracy_meters: input.accuracyMeters,
      captured_at: input.capturedAt,
      mime_type: input.mimeType,
      image_key: '',
      thumbnail_key: null,
      upload_id: input.uploadId,
      processing_status: 'queued',
      picked_up: input.pickedUp ?? true,
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
    savedSpot.original_size_bytes = input.imageBuffer.length;
    savedSpot.thumbnail_size_bytes = input.thumbnailBuffer?.length ?? 0;
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
      warning,
    };
  }

  private static readonly ITEM_LABEL_RELATIONS = [
    'items',
    'items.object_label', 'items.object_label.translations',
    'items.material_label', 'items.material_label.translations',
    'items.brand_label', 'items.brand_label.translations',
  ];

  async getSpotStatus(spotId: string, userId: string): Promise<Spot> {
    const spot = await this.spotRepository.findOne({
      where: {
        id: spotId,
        user_id: userId,
      },
      relations: SpotService.ITEM_LABEL_RELATIONS,
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
      relations: SpotService.ITEM_LABEL_RELATIONS,
    });

    if (!spot) {
      throw new NotFoundException('Spot not found');
    }

    return spot;
  }

  async listSpotsForUser(
    userId: string,
    limit: number,
    filters?: { pickedUp?: boolean; since?: string },
  ): Promise<Spot[]> {
    return this.listSpotsWithFilters(userId, limit, filters);
  }

  async listSpotsForGuest(
    guestId: string,
    limit: number,
    filters?: { pickedUp?: boolean; since?: string },
  ): Promise<Spot[]> {
    return this.listSpotsWithFilters(guestId, limit, filters);
  }

  private async listSpotsWithFilters(
    userId: string,
    limit: number,
    filters?: { pickedUp?: boolean; since?: string },
  ): Promise<Spot[]> {
    const qb = this.spotRepository.createQueryBuilder('spot')
      .leftJoinAndSelect('spot.items', 'items')
      .leftJoinAndSelect('items.object_label', 'objectLabel')
      .leftJoinAndSelect('objectLabel.translations', 'objectLabelTranslations')
      .leftJoinAndSelect('items.material_label', 'materialLabel')
      .leftJoinAndSelect('materialLabel.translations', 'materialLabelTranslations')
      .leftJoinAndSelect('items.brand_label', 'brandLabel')
      .leftJoinAndSelect('brandLabel.translations', 'brandLabelTranslations')
      .where('spot.user_id = :userId', { userId })
      .orderBy('spot.captured_at', 'DESC')
      .take(limit);

    if (filters?.pickedUp !== undefined) {
      qb.andWhere('spot.picked_up = :pickedUp', { pickedUp: filters.pickedUp });
    }
    if (filters?.since) {
      qb.andWhere('spot.captured_at >= :since', { since: filters.since });
    }

    return qb.getMany();
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

  async updateSpot(
    spotId: string,
    userId: string,
    updates: { pickedUp?: boolean; cleanupId?: string | null; cleanupDateId?: string | null },
  ): Promise<Spot> {
    const spot = await this.spotRepository.findOne({
      where: { id: spotId, user_id: userId },
      relations: SpotService.ITEM_LABEL_RELATIONS,
    });
    if (!spot) throw new NotFoundException('Spot not found');

    if (updates.pickedUp !== undefined) {
      spot.picked_up = updates.pickedUp;
    }

    const cleanupProvided = updates.cleanupId !== undefined || updates.cleanupDateId !== undefined;
    if (cleanupProvided) {
      const newCleanupId = updates.cleanupId ?? null;
      const newCleanupDateId = updates.cleanupDateId ?? null;

      if ((newCleanupId === null) !== (newCleanupDateId === null)) {
        throw new BadRequestException('cleanupId and cleanupDateId must both be set or both be null');
      }

      if (newCleanupId && newCleanupDateId) {
        const validation = await this.cleanupService.validateExplicitCleanupAssociation(
          userId, newCleanupId, newCleanupDateId, spot.captured_at,
        );
        if (!validation.valid) {
          throw new BadRequestException(validation.warning || 'Invalid cleanup association');
        }
      }

      spot.cleanup_id = newCleanupId;
      spot.cleanup_date_id = newCleanupDateId;
    }

    return this.spotRepository.save(spot);
  }

  async updateDetectedItem(
    itemId: string,
    spotId: string,
    userId: string,
    updates: { objectLabelId?: string; materialLabelId?: string; brandLabelId?: string; weightGrams?: number | null },
  ): Promise<DetectedItem> {
    const item = await this.detectedItemRepository.findOne({ where: { id: itemId, spot_id: spotId } });
    if (!item) throw new NotFoundException('Detected item not found');

    const labelFields: Array<{ field: string; labelId?: string; type: string }> = [
      { field: 'object_label_id', labelId: updates.objectLabelId, type: 'object' },
      { field: 'material_label_id', labelId: updates.materialLabelId, type: 'material' },
      { field: 'brand_label_id', labelId: updates.brandLabelId, type: 'brand' },
    ];

    for (const { labelId, type } of labelFields) {
      if (labelId === undefined) continue;
      const label = await this.labelService.findByIdAndType(labelId, type);
      if (!label) throw new BadRequestException(`Invalid ${type} label ID`);
    }

    const result = await this.dataSource.transaction(async (manager) => {
      for (const { field, labelId, type } of labelFields) {
        if (labelId === undefined) continue;

        const oldValue = (item as any)[field];
        if (oldValue === labelId) continue;

        const edit = this.detectedItemEditRepository.create({
          detected_item_id: itemId,
          field_changed: field,
          old_value: oldValue,
          new_value: labelId,
          created_by: userId,
        });
        await manager.save(edit);
        (item as any)[field] = labelId;
        // Clear the eager relation so TypeORM doesn't overwrite the FK from the stale object
        const relationField = field.replace('_id', '');
        (item as any)[relationField] = undefined;
      }

      if (updates.weightGrams !== undefined) {
        const oldWeight = item.weight_grams;
        const newWeight = updates.weightGrams;
        if (oldWeight !== newWeight) {
          const edit = this.detectedItemEditRepository.create({
            detected_item_id: itemId,
            field_changed: 'weight_grams',
            old_value: oldWeight !== null ? String(oldWeight) : null,
            new_value: newWeight !== null ? String(newWeight) : null,
            created_by: userId,
          });
          await manager.save(edit);
          item.weight_grams = newWeight;
        }
      }

      item.human_verified = true;
      return manager.save(item);
    });

    // Clear identity map so subsequent queries fetch fresh data with updated relations
    this.spotRepository.manager.clear(Spot);
    this.detectedItemRepository.manager.clear(DetectedItem);

    return result;
  }

  async addDetectedItem(
    spotId: string,
    userId: string,
    input: { objectLabelId?: string; materialLabelId?: string; brandLabelId?: string; weightGrams?: number },
  ): Promise<DetectedItem> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId, user_id: userId } });
    if (!spot) throw new NotFoundException('Spot not found');

    const labelFields: Array<{ field: string; labelId?: string; type: string }> = [
      { field: 'object_label_id', labelId: input.objectLabelId, type: 'object' },
      { field: 'material_label_id', labelId: input.materialLabelId, type: 'material' },
      { field: 'brand_label_id', labelId: input.brandLabelId, type: 'brand' },
    ];

    for (const { labelId, type } of labelFields) {
      if (!labelId) continue;
      const label = await this.labelService.findByIdAndType(labelId, type);
      if (!label) throw new BadRequestException(`Invalid ${type} label ID`);
    }

    return this.dataSource.transaction(async (manager) => {
      const item = this.detectedItemRepository.create({
        spot_id: spotId,
        object_label_id: input.objectLabelId ?? null,
        material_label_id: input.materialLabelId ?? null,
        brand_label_id: input.brandLabelId ?? null,
        weight_grams: input.weightGrams ?? null,
        human_verified: true,
        source_model: 'manual',
      });
      const saved = await manager.save(item);

      for (const { field, labelId } of labelFields) {
        if (!labelId) continue;
        const edit = this.detectedItemEditRepository.create({
          detected_item_id: saved.id,
          field_changed: field,
          old_value: null,
          new_value: labelId,
          created_by: userId,
        });
        await manager.save(edit);
      }

      if (input.weightGrams !== undefined && input.weightGrams !== null) {
        const edit = this.detectedItemEditRepository.create({
          detected_item_id: saved.id,
          field_changed: 'weight_grams',
          old_value: null,
          new_value: String(input.weightGrams),
          created_by: userId,
        });
        await manager.save(edit);
      }

      return saved;
    });
  }

  async deleteDetectedItem(itemId: string, spotId: string, userId: string): Promise<void> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId, user_id: userId } });
    if (!spot) throw new NotFoundException('Spot not found');

    const item = await this.detectedItemRepository.findOne({ where: { id: itemId, spot_id: spotId } });
    if (!item) throw new NotFoundException('Detected item not found');

    await this.detectedItemRepository.remove(item);
  }

  async deleteSpot(spotId: string, userId: string): Promise<void> {
    const spot = await this.spotRepository.findOne({
      where: { id: spotId, user_id: userId },
      relations: ['items'],
    });
    if (!spot) throw new NotFoundException('Spot not found');

    await this.deleteSpotInternal(spot);
  }

  private async deleteSpotInternal(spot: Spot): Promise<void> {
    const itemCount = spot.items?.length ?? 0;
    this.logger.log(
      `Deleting spot ${spot.id}: user=${spot.user_id}, items=${itemCount}, captured_at=${spot.captured_at.toISOString()}`,
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
