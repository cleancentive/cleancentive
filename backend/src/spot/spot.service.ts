import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Spot, type SubjectKind } from './spot.entity';
import { DetectedItem } from './detected-item.entity';
import { DetectedItemEdit } from './detected-item-edit.entity';
import { SpotEdit } from './spot-edit.entity';
import { TeamService } from '../team/team.service';
import { CleanupService } from '../cleanup/cleanup.service';
import { LabelService } from '../label/label.service';
import { redisConnection } from '../common/redis-connection';
import { createS3Client } from '../common/s3-client';
import { PROCESSING_STATUS, isValidLatLng, isValidAccuracyMeters } from '@cleancentive/shared';

interface CreateSpotInput {
  userId: string;
  uploadId: string;
  imageBuffer: Buffer;
  thumbnailBuffer: Buffer | null;
  mimeType: string;
  capturedAt: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  pickedUp?: boolean;
  cleanupId?: string | null;
  cleanupDateId?: string | null;
  subjectKind?: SubjectKind;
}

interface CreateSpotResult {
  spot: Spot;
  warning: string | null;
}

export interface SpotListFilters {
  pickedUp?: boolean;
  since?: string;
  before?: string;
}

export interface SpotListPage {
  items: Spot[];
  nextCursor: string | null;
}

export interface SpotEditHistoryEntry {
  id: string;
  entityType: 'item' | 'spot';
  detectedItemId: string | null;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
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
    @InjectRepository(SpotEdit)
    private readonly spotEditRepository: Repository<SpotEdit>,
    private readonly dataSource: DataSource,
    private readonly teamService: TeamService,
    private readonly cleanupService: CleanupService,
    private readonly labelService: LabelService,
  ) {
    this.detectionQueue = new Queue(this.queueName, {
      connection: redisConnection(),
    });

    this.s3Client = createS3Client();
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

    // Image dedup: same user + same image bytes uploaded within the last 24h
    // returns the prior spot, matching the (user_id, upload_id) idempotency idiom.
    const imageSha256 = createHash('sha256').update(input.imageBuffer).digest('hex');
    const since24hIso = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const dupeRows = await this.spotRepository.query(
      `SELECT id FROM spots
       WHERE user_id = $1 AND image_sha256 = $2 AND created_at >= $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.userId, imageSha256, since24hIso],
    );
    if (dupeRows[0]?.id) {
      const dupe = await this.spotRepository.findOne({ where: { id: dupeRows[0].id } });
      if (dupe) return { spot: dupe, warning: null };
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

    // Pick Session grouping: same user, uploaded within the last 60s, within
    // ~20m of the new coords reuses the prior session id; otherwise a fresh one.
    // Bbox-only proximity is good enough at 20m precision (no haversine).
    const sessionSinceIso = new Date(Date.now() - 60_000).toISOString();
    const latDelta = 0.0002;
    const lngDelta = 0.0003;
    const recentSession = await this.spotRepository.query(
      `SELECT pick_session_id FROM spots
       WHERE user_id = $1
         AND created_at >= $2
         AND latitude  BETWEEN $3 AND $4
         AND longitude BETWEEN $5 AND $6
         AND pick_session_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [
        input.userId,
        sessionSinceIso,
        input.latitude - latDelta,
        input.latitude + latDelta,
        input.longitude - lngDelta,
        input.longitude + lngDelta,
      ],
    );
    const pickSessionId: string = recentSession[0]?.pick_session_id ?? randomUUID();

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
      processing_status: PROCESSING_STATUS.QUEUED,
      picked_up: input.pickedUp ?? true,
      pick_session_id: pickSessionId,
      image_sha256: imageSha256,
      subject_kind: input.subjectKind ?? 'litter',
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
        savedSpot.subject_kind === 'plant' ? 'identify-plant' : 'detect-litter',
        {
          spotId: savedSpot.id,
          userId: savedSpot.user_id,
          imageKey: savedSpot.image_key,
          mimeType: savedSpot.mime_type,
          subjectKind: savedSpot.subject_kind,
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
      savedSpot.processing_status = PROCESSING_STATUS.FAILED;
      savedSpot.processing_error = 'Failed to enqueue detection job';
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

  private async fetchSpotByOwner(spotId: string, ownerId: string): Promise<Spot> {
    const spot = await this.spotRepository.findOne({
      where: {
        id: spotId,
        user_id: ownerId,
      },
      relations: SpotService.ITEM_LABEL_RELATIONS,
    });

    if (!spot) {
      throw new NotFoundException('Spot not found');
    }

    return spot;
  }

  async getSpotStatus(spotId: string, userId: string): Promise<Spot> {
    return this.fetchSpotByOwner(spotId, userId);
  }

  async getSpotStatusForGuest(spotId: string, guestId: string): Promise<Spot> {
    return this.fetchSpotByOwner(spotId, guestId);
  }

  async getSpotPublic(spotId: string): Promise<Spot> {
    const spot = await this.spotRepository.findOne({
      where: { id: spotId },
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
    filters?: SpotListFilters,
  ): Promise<SpotListPage> {
    return this.listSpotsWithFilters(userId, limit, filters);
  }

  async listSpotsForGuest(
    guestId: string,
    limit: number,
    filters?: SpotListFilters,
  ): Promise<SpotListPage> {
    return this.listSpotsWithFilters(guestId, limit, filters);
  }

  private async listSpotsWithFilters(
    userId: string,
    limit: number,
    filters?: SpotListFilters,
  ): Promise<SpotListPage> {
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
      .addOrderBy('spot.id', 'DESC')
      .take(limit + 1);

    if (filters?.pickedUp !== undefined) {
      qb.andWhere('spot.picked_up = :pickedUp', { pickedUp: filters.pickedUp });
    }
    if (filters?.since) {
      qb.andWhere('spot.captured_at >= :since', { since: filters.since });
    }
    if (filters?.before) {
      const sep = filters.before.indexOf('|');
      if (sep > 0) {
        const beforeAt = filters.before.slice(0, sep);
        const beforeId = filters.before.slice(sep + 1);
        if (beforeAt && beforeId && !Number.isNaN(new Date(beforeAt).getTime())) {
          qb.andWhere(
            '(spot.captured_at, spot.id) < (:beforeAt, :beforeId)',
            { beforeAt, beforeId },
          );
        }
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    const nextCursor = hasMore && last
      ? `${last.captured_at.toISOString()}|${last.id}`
      : null;

    return { items, nextCursor };
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
    updates: {
      pickedUp?: boolean;
      cleanupId?: string | null;
      cleanupDateId?: string | null;
      latitude?: number;
      longitude?: number;
      accuracyMeters?: number | null;
    },
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

    const latProvided = updates.latitude !== undefined;
    const lngProvided = updates.longitude !== undefined;
    if (latProvided !== lngProvided) {
      throw new BadRequestException('latitude and longitude must both be set');
    }

    const locationChanges: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];

    if (latProvided && lngProvided) {
      const newLat = updates.latitude!;
      const newLng = updates.longitude!;
      if (!isValidLatLng(newLat, newLng)) {
        throw new BadRequestException('latitude must be in [-90, 90] and longitude must be in [-180, 180]');
      }

      const maxAccuracy = Number(process.env.LOCATION_ACCURACY_SANITY_BOUND_METERS ?? 10000);
      let newAccuracy: number | null = null;
      if (updates.accuracyMeters !== undefined && updates.accuracyMeters !== null) {
        if (!isValidAccuracyMeters(updates.accuracyMeters, maxAccuracy)) {
          throw new BadRequestException(`accuracyMeters must be a finite number in [0, ${maxAccuracy}]`);
        }
        newAccuracy = updates.accuracyMeters;
      }

      const latChanged = spot.latitude !== newLat;
      const lngChanged = spot.longitude !== newLng;
      const accChanged = spot.location_accuracy_meters !== newAccuracy;

      if (latChanged) {
        locationChanges.push({ field: 'latitude', oldValue: String(spot.latitude), newValue: String(newLat) });
        spot.latitude = newLat;
      }
      if (lngChanged) {
        locationChanges.push({ field: 'longitude', oldValue: String(spot.longitude), newValue: String(newLng) });
        spot.longitude = newLng;
      }
      if (accChanged) {
        locationChanges.push({
          field: 'location_accuracy_meters',
          oldValue: spot.location_accuracy_meters !== null ? String(spot.location_accuracy_meters) : null,
          newValue: newAccuracy !== null ? String(newAccuracy) : null,
        });
        spot.location_accuracy_meters = newAccuracy;
      }
    }

    if (locationChanges.length === 0) {
      return this.spotRepository.save(spot);
    }

    return this.dataSource.transaction(async (manager) => {
      for (const change of locationChanges) {
        const edit = this.spotEditRepository.create({
          spot_id: spot.id,
          field_changed: change.field,
          old_value: change.oldValue,
          new_value: change.newValue,
          created_by: userId,
        });
        await manager.save(edit);
      }
      return manager.save(spot);
    });
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
    const spot = await this.spotRepository.findOne({ where: { id: spotId } });
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
    const spot = await this.spotRepository.findOne({ where: { id: spotId } });
    if (!spot) throw new NotFoundException('Spot not found');

    const item = await this.detectedItemRepository.findOne({ where: { id: itemId, spot_id: spotId } });
    if (!item) throw new NotFoundException('Detected item not found');

    await this.dataSource.transaction(async (manager) => {
      const fieldSnapshots: Array<{ field: string; value: string | null }> = [
        { field: 'object_label_id', value: item.object_label_id },
        { field: 'material_label_id', value: item.material_label_id },
        { field: 'brand_label_id', value: item.brand_label_id },
        { field: 'weight_grams', value: item.weight_grams !== null ? String(item.weight_grams) : null },
      ];

      for (const { field, value } of fieldSnapshots) {
        if (value === null) continue;
        const edit = this.detectedItemEditRepository.create({
          detected_item_id: itemId,
          field_changed: field,
          old_value: value,
          new_value: null,
          created_by: userId,
        });
        await manager.save(edit);
      }

      const tombstone = this.detectedItemEditRepository.create({
        detected_item_id: itemId,
        field_changed: 'deleted',
        old_value: itemId,
        new_value: spotId,
        created_by: userId,
      });
      await manager.save(tombstone);

      await manager.remove(item);
    });
  }

  async listSpotEditHistory(spotId: string): Promise<SpotEditHistoryEntry[]> {
    const spot = await this.spotRepository.findOne({ where: { id: spotId } });
    if (!spot) throw new NotFoundException('Spot not found');

    const liveItemIds = (await this.detectedItemRepository.find({
      where: { spot_id: spotId },
      select: ['id'],
    })).map((row) => row.id);

    const itemQb = this.detectedItemEditRepository
      .createQueryBuilder('edit')
      .leftJoinAndSelect('edit.user', 'user')
      .where(`edit.field_changed = 'deleted' AND edit.new_value = :spotId`, { spotId });

    if (liveItemIds.length > 0) {
      itemQb.orWhere('edit.detected_item_id IN (:...liveItemIds)', { liveItemIds });
    }

    const [itemEdits, spotEdits] = await Promise.all([
      itemQb.orderBy('edit.created_at', 'DESC').addOrderBy('edit.id', 'DESC').getMany(),
      this.spotEditRepository
        .createQueryBuilder('edit')
        .leftJoinAndSelect('edit.user', 'user')
        .where('edit.spot_id = :spotId', { spotId })
        .orderBy('edit.created_at', 'DESC')
        .addOrderBy('edit.id', 'DESC')
        .getMany(),
    ]);

    const itemEntries: SpotEditHistoryEntry[] = itemEdits.map((edit) => ({
      id: edit.id,
      entityType: 'item',
      detectedItemId: edit.detected_item_id,
      fieldChanged: edit.field_changed,
      oldValue: edit.old_value,
      newValue: edit.new_value,
      createdBy: edit.created_by,
      createdByName: edit.user?.nickname ?? null,
      createdAt: edit.created_at,
    }));

    const spotEntries: SpotEditHistoryEntry[] = spotEdits.map((edit) => ({
      id: edit.id,
      entityType: 'spot',
      detectedItemId: null,
      fieldChanged: edit.field_changed,
      oldValue: edit.old_value,
      newValue: edit.new_value,
      createdBy: edit.created_by,
      createdByName: edit.user?.nickname ?? null,
      createdAt: edit.created_at,
    }));

    return [...itemEntries, ...spotEntries].sort((a, b) => {
      const t = b.createdAt.getTime() - a.createdAt.getTime();
      return t !== 0 ? t : b.id.localeCompare(a.id);
    });
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
    if (spot.processing_status !== PROCESSING_STATUS.FAILED) throw new BadRequestException('Only failed spots can be retried');

    spot.processing_status = PROCESSING_STATUS.QUEUED;
    spot.processing_error = null;
    spot.detection_started_at = null;
    await this.spotRepository.save(spot);

    const existingJob = await this.detectionQueue.getJob(spot.id);
    if (existingJob) {
      await existingJob.retry();
      return;
    }

    await this.detectionQueue.add(
      spot.subject_kind === 'plant' ? 'identify-plant' : 'detect-litter',
      { spotId: spot.id, userId: spot.user_id, imageKey: spot.image_key, mimeType: spot.mime_type, subjectKind: spot.subject_kind },
      { jobId: spot.id, attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false },
    );
  }

}
