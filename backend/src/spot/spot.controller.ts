import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { MulterExceptionFilter } from '../common/multer-exception.filter';
import { SpotService } from './spot.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../user/user.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags } from '@nestjs/swagger';
import { PROCESSING_STATUS, isValidLatLng, isValidAccuracyMeters } from '@cleancentive/shared';

type UploadFiles = {
  image?: Array<{ buffer: Buffer; mimetype: string; size: number }>;
  thumbnail?: Array<{ buffer: Buffer; mimetype: string; size: number }>;
};

interface LabelRef {
  id: string;
  name: string;
}

interface DetectedItemDto {
  id: string;
  objectLabel: LabelRef | null;
  materialLabel: LabelRef | null;
  brandLabel: LabelRef | null;
  matchConfidence: number | null;
  humanVerified: boolean;
  weightGrams: number | null;
  confidence: number | null;
}

interface PlantIdentificationDto {
  scientificName: string;
  commonNameEn: string | null;
  confidence: number | null;
  identificationSource: string;
  isInvasive: boolean;
  invasiveList: string | null;
  recommendedAction: string | null;
  humanVerified: boolean;
}

interface SpotDto {
  id: string;
  status: string;
  userId: string;
  teamId: string | null;
  cleanupId: string | null;
  cleanupDateId: string | null;
  capturedAt: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  pickedUp: boolean;
  subjectKind: 'litter' | 'plant';
  processingError: string | null;
  detectionCompletedAt: Date | null;
  items: DetectedItemDto[];
  plantIdentification: PlantIdentificationDto | null;
}

@Controller('spots')
@ApiTags('spots')
export class SpotController {
  private readonly maxUploadSizeBytes = parseInt(process.env.UPLOAD_MAX_SIZE_BYTES || `${15 * 1024 * 1024}`, 10);
  private readonly accuracySanityBoundMeters = parseFloat(process.env.LOCATION_ACCURACY_SANITY_BOUND_METERS || '10000');

  constructor(
    private readonly spotService: SpotService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  private toLabelRef(label: any): LabelRef | null {
    if (!label) return null;
    const enTranslation = label.translations?.find((t: any) => t.locale === 'en');
    return { id: label.id, name: enTranslation?.name ?? label.id };
  }

  private toSpotDto(spot: any): SpotDto {
    const pi = spot.plant_identification;
    return {
      id: spot.id,
      status: spot.processing_status,
      userId: spot.user_id,
      teamId: spot.team_id,
      cleanupId: spot.cleanup_id,
      cleanupDateId: spot.cleanup_date_id,
      capturedAt: spot.captured_at,
      latitude: spot.latitude,
      longitude: spot.longitude,
      accuracyMeters: spot.location_accuracy_meters,
      pickedUp: spot.picked_up,
      subjectKind: spot.subject_kind ?? 'litter',
      processingError: spot.processing_error,
      detectionCompletedAt: spot.detection_completed_at,
      items: (spot.items ?? []).map((item: any) => ({
        id: item.id,
        objectLabel: this.toLabelRef(item.object_label),
        materialLabel: this.toLabelRef(item.material_label),
        brandLabel: this.toLabelRef(item.brand_label),
        matchConfidence: item.match_confidence,
        humanVerified: item.human_verified,
        weightGrams: item.weight_grams,
        confidence: item.confidence,
      })),
      plantIdentification: pi
        ? {
            scientificName: pi.scientific_name,
            commonNameEn: pi.common_name_en,
            confidence: pi.confidence,
            identificationSource: pi.identification_source,
            isInvasive: pi.is_invasive,
            invasiveList: pi.invasive_list,
            recommendedAction: pi.recommended_action,
            humanVerified: pi.human_verified,
          }
        : null,
    };
  }

  private async resolveAuthUserId(authHeader: string | undefined): Promise<string> {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization header is required');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Invalid Authorization header');
    }
    try {
      const payload = await this.authService.validateSessionToken(token);
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid session token');
    }
  }

  private requireGuestId(guestId: string | undefined): string {
    if (!guestId) {
      throw new BadRequestException('guestId is required when not authenticated');
    }
    return guestId;
  }

  private async resolveUserIdWithCreate(authHeader: string | undefined, guestId: string | undefined): Promise<string> {
    if (authHeader?.startsWith('Bearer ')) {
      return this.resolveAuthUserId(authHeader);
    }
    const id = this.requireGuestId(guestId);
    const guest = await this.userService.findOrCreateGuest(id);
    return guest.id;
  }

  @Post()
  @HttpCode(202)
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        limits: {
          fileSize: parseInt(process.env.UPLOAD_MAX_SIZE_BYTES || `${15 * 1024 * 1024}`, 10),
        },
      },
    ),
  )
  async createSpot(
    @UploadedFiles() files: UploadFiles,
    @Req() req: Request,
  ): Promise<{ spotId: string; status: string; warning?: string }> {
    const image = files?.image?.[0];
    const thumbnail = files?.thumbnail?.[0];

    if (!image) {
      throw new BadRequestException('image file is required');
    }

    if (image.size > this.maxUploadSizeBytes) {
      throw new PayloadTooLargeException(`image exceeds max size of ${this.maxUploadSizeBytes} bytes`);
    }

    const body = req.body as Record<string, string | undefined>;

    const uploadId = body.uploadId?.trim();
    const latitude = parseFloat(body.latitude || '');
    const longitude = parseFloat(body.longitude || '');
    const rawAccuracy = body.accuracyMeters?.trim();
    const accuracy: number | null =
      rawAccuracy && rawAccuracy.length > 0 && Number.isFinite(parseFloat(rawAccuracy))
        ? parseFloat(rawAccuracy)
        : null;
    const capturedAt = new Date(body.capturedAt || '');
    const guestId = body.guestId?.trim();
    const pickedUp = body.pickedUp === undefined ? true : body.pickedUp !== 'false';
    const cleanupId = body.cleanupId?.trim() || null;
    const cleanupDateId = body.cleanupDateId?.trim() || null;
    const subjectKindRaw = body.subjectKind?.trim();
    const subjectKind: 'litter' | 'plant' = subjectKindRaw === 'plant' ? 'plant' : 'litter';

    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }

    if (!isValidLatLng(latitude, longitude)) {
      throw new BadRequestException('latitude must be in [-90, 90] and longitude must be in [-180, 180]');
    }

    if (accuracy !== null && !isValidAccuracyMeters(accuracy, this.accuracySanityBoundMeters)) {
      throw new BadRequestException(
        `accuracyMeters must be between 0 and ${this.accuracySanityBoundMeters} meters when provided`,
      );
    }

    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('capturedAt must be a valid ISO date');
    }

    const userId = await this.resolveUserIdWithCreate(req.headers.authorization, guestId);

    const result = await this.spotService.createSpot({
      userId,
      uploadId,
      imageBuffer: image.buffer,
      thumbnailBuffer: thumbnail?.buffer || null,
      mimeType: image.mimetype || 'image/jpeg',
      capturedAt,
      latitude,
      longitude,
      accuracyMeters: accuracy,
      pickedUp,
      cleanupId,
      cleanupDateId,
      subjectKind,
    });

    return {
      spotId: result.spot.id,
      status: result.spot.processing_status,
      ...(result.warning ? { warning: result.warning } : {}),
    };
  }

  @Get(':id')
  async getSpotStatus(
    @Param('id', ParseUUIDPipe) spotId: string,
    @Req() req: Request,
    @Query('guestId') guestId?: string,
  ): Promise<SpotDto> {
    let spot;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      const userId = await this.resolveAuthUserId(req.headers.authorization);
      spot = await this.spotService.getSpotStatus(spotId, userId);
    } else {
      if (!guestId) {
        throw new BadRequestException('guestId is required when not authenticated');
      }
      spot = await this.spotService.getSpotStatusForGuest(spotId, guestId);
    }

    return this.toSpotDto(spot);
  }

  @Get(':id/view')
  async getSpotPublic(
    @Param('id', ParseUUIDPipe) spotId: string,
  ): Promise<SpotDto> {
    const spot = await this.spotService.getSpotPublic(spotId);
    return this.toSpotDto(spot);
  }

  @Get(':id/edit-history')
  async getSpotEditHistory(
    @Param('id', ParseUUIDPipe) spotId: string,
  ): Promise<{ entries: Array<{
    id: string;
    entityType: 'item' | 'spot';
    detectedItemId: string | null;
    fieldChanged: string;
    oldValue: string | null;
    newValue: string | null;
    createdBy: string;
    createdByName: string | null;
    createdAt: Date;
  }> }> {
    const entries = await this.spotService.listSpotEditHistory(spotId);
    return { entries };
  }

  @Get()
  async listSpots(
    @Req() req: Request,
    @Query('guestId') guestId?: string,
    @Query('limit') limitQuery?: string,
    @Query('picked_up') pickedUpQuery?: string,
    @Query('since') sinceQuery?: string,
    @Query('before') beforeQuery?: string,
  ): Promise<{ spots: SpotDto[]; nextCursor: string | null }> {
    const parsedLimit = parseInt(limitQuery || '20', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20;

    const pickedUp = this.parseBooleanParam(pickedUpQuery);
    const since = sinceQuery && !Number.isNaN(new Date(sinceQuery).getTime()) ? sinceQuery : undefined;
    const before = beforeQuery && beforeQuery.includes('|') ? beforeQuery : undefined;

    const page = req.headers.authorization?.startsWith('Bearer ')
      ? await this.spotService.listSpotsForUser(
        await this.resolveAuthUserId(req.headers.authorization),
        limit,
        { pickedUp, since, before },
      )
      : await this.spotService.listSpotsForGuest(
        this.requireGuestId(guestId),
        limit,
        { pickedUp, since, before },
      );

    return {
      spots: page.items.map((spot) => this.toSpotDto(spot)),
      nextCursor: page.nextCursor,
    };
  }

  private parseBooleanParam(value?: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }

  @Post(':id/retry')
  @HttpCode(202)
  async retryDetection(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Query('guestId') guestId?: string,
  ): Promise<{ status: string }> {
    const userId = req.headers.authorization?.startsWith('Bearer ')
      ? await this.resolveAuthUserId(req.headers.authorization)
      : this.requireGuestId(guestId);
    await this.spotService.retryDetection(id, userId);
    return { status: PROCESSING_STATUS.QUEUED };
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteSpot(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Query('guestId') guestId?: string,
  ): Promise<void> {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      const userId = await this.resolveAuthUserId(req.headers.authorization);
      await this.spotService.deleteSpot(id, userId);
    } else {
      const guest = this.requireGuestId(guestId);
      await this.spotService.deleteSpot(id, guest);
    }
  }

  @Patch(':id')
  async updateSpot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      pickedUp?: boolean;
      cleanupId?: string;
      cleanupDateId?: string;
      latitude?: number;
      longitude?: number;
      accuracyMeters?: number | null;
    },
    @Req() req: Request,
    @Query('guestId') guestId?: string,
  ): Promise<SpotDto> {
    let userId: string;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      userId = await this.resolveAuthUserId(req.headers.authorization);
    } else {
      userId = this.requireGuestId(guestId);
    }

    const latProvided = body.latitude !== undefined;
    const lngProvided = body.longitude !== undefined;
    if (latProvided !== lngProvided) {
      throw new BadRequestException('latitude and longitude must both be provided');
    }
    if (latProvided && lngProvided && !isValidLatLng(body.latitude, body.longitude)) {
      throw new BadRequestException('latitude must be in [-90, 90] and longitude must be in [-180, 180]');
    }
    if (body.accuracyMeters !== undefined && body.accuracyMeters !== null
        && !isValidAccuracyMeters(body.accuracyMeters, this.accuracySanityBoundMeters)) {
      throw new BadRequestException(
        `accuracyMeters must be between 0 and ${this.accuracySanityBoundMeters} meters when provided`,
      );
    }

    const spot = await this.spotService.updateSpot(id, userId, body);
    return this.toSpotDto(spot);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':spotId/items')
  async addDetectedItem(
    @Param('spotId', ParseUUIDPipe) spotId: string,
    @Body() body: { objectLabelId?: string; materialLabelId?: string; brandLabelId?: string; weightGrams?: number },
    @Req() req: any,
  ) {
    const item = await this.spotService.addDetectedItem(spotId, req.user.userId, body);
    return {
      id: item.id,
      objectLabelId: item.object_label_id,
      materialLabelId: item.material_label_id,
      brandLabelId: item.brand_label_id,
      weightGrams: item.weight_grams,
      humanVerified: item.human_verified,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':spotId/items/:itemId')
  @HttpCode(204)
  async deleteDetectedItem(
    @Param('spotId', ParseUUIDPipe) spotId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() req: any,
  ): Promise<void> {
    await this.spotService.deleteDetectedItem(itemId, spotId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':spotId/items/:itemId')
  async updateDetectedItem(
    @Param('spotId', ParseUUIDPipe) spotId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: { objectLabelId?: string; materialLabelId?: string; brandLabelId?: string; weightGrams?: number | null },
    @Req() req: any,
  ) {
    const item = await this.spotService.updateDetectedItem(itemId, spotId, req.user.userId, body);
    return {
      id: item.id,
      objectLabelId: item.object_label_id,
      materialLabelId: item.material_label_id,
      brandLabelId: item.brand_label_id,
      weightGrams: item.weight_grams,
      humanVerified: item.human_verified,
    };
  }

  @Get(':id/plant-identification')
  async getPlantIdentification(
    @Param('id', ParseUUIDPipe) spotId: string,
  ): Promise<PlantIdentificationDto> {
    const pi = await this.spotService.getPlantIdentification(spotId);
    if (!pi) throw new NotFoundException('Plant identification not found');
    return {
      scientificName: pi.scientific_name,
      commonNameEn: pi.common_name_en,
      confidence: pi.confidence,
      identificationSource: pi.identification_source,
      isInvasive: pi.is_invasive,
      invasiveList: pi.invasive_list,
      recommendedAction: pi.recommended_action,
      humanVerified: pi.human_verified,
    };
  }

  @Get(':id/thumbnail')
  async getThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.spotService.getThumbnailStream(id);
    if (!result) throw new NotFoundException('Thumbnail not available');
    res.set({ 'Content-Type': result.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' });
    return new StreamableFile(result.body as any);
  }
}
