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
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { MulterExceptionFilter } from '../common/multer-exception.filter';
import { SpotService } from './spot.service';
import { UserService } from '../user/user.service';
import { GuestOrUserAuthGuard } from '../auth/guest-or-user-auth.guard';
import { RequireApiKeyScope } from '../api-key/api-key.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { ApiTags, ApiSecurity } from '@nestjs/swagger';
import sharp = require('sharp');
import { PROCESSING_STATUS, isValidLatLng, isValidAccuracyMeters, lookupInvasive } from '@cleancentive/shared';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heif: 'image/heic',
};

/**
 * What this file actually is, read from its bytes.
 *
 * The Content-Type on a multipart part is whatever the client wrote, and it
 * ends up as the stored object's content type and its file extension. sharp
 * reads the container for the formats it decodes; HEIC needs the manual check
 * because the prebuilt binary cannot decode it, and batch import uploads camera
 * originals untouched.
 */
async function detectImageMime(buffer: Buffer): Promise<string | null> {
  if (isHeic(buffer)) return MIME_BY_FORMAT.heif;
  try {
    const { format } = await sharp(buffer).metadata();
    return format ? MIME_BY_FORMAT[format] ?? null : null;
  } catch {
    return null;
  }
}

/** ISO base media file format box with a HEIC brand. */
function isHeic(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false;
  const brand = buffer.toString('latin1', 8, 12);
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
}

type UploadFiles = {
  image?: Array<{ buffer: Buffer; mimetype: string; size: number }>;
  thumbnail?: Array<{ buffer: Buffer; mimetype: string; size: number }>;
};

interface LabelRef {
  id: string;
  name: string;
  scientificName?: string | null;
}

interface PlantInvasiveInfo {
  list: 'infoflora_black' | 'infoflora_watch';
  recommendedAction: string;
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
  plantInvasive: PlantInvasiveInfo | null;
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
  hasOriginal: boolean;
  items: DetectedItemDto[];
}

@Controller('spots')
@ApiTags('spots')
export class SpotController {
  private readonly maxUploadSizeBytes = parseInt(process.env.UPLOAD_MAX_SIZE_BYTES || `${15 * 1024 * 1024}`, 10);
  private readonly accuracySanityBoundMeters = parseFloat(process.env.LOCATION_ACCURACY_SANITY_BOUND_METERS || '10000');

  constructor(
    private readonly spotService: SpotService,
    private readonly userService: UserService,
  ) {}

  private toLabelRef(label: any): LabelRef | null {
    if (!label) return null;
    const enTranslation = label.translations?.find((t: any) => t.locale === 'en');
    return {
      id: label.id,
      name: enTranslation?.name ?? label.id,
      ...(label.scientific_name ? { scientificName: label.scientific_name } : {}),
    };
  }

  private toSpotDto(spot: any): SpotDto {
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
      hasOriginal: spot.original_purged_at === null && !!spot.image_key,
      items: (spot.items ?? []).map((item: any) => {
        const invasive = item.object_label?.scientific_name
          ? lookupInvasive(item.object_label.scientific_name)
          : null;
        return {
          id: item.id,
          objectLabel: this.toLabelRef(item.object_label),
          materialLabel: this.toLabelRef(item.material_label),
          brandLabel: this.toLabelRef(item.brand_label),
          matchConfidence: item.match_confidence,
          humanVerified: item.human_verified,
          weightGrams: item.weight_grams,
          confidence: item.confidence,
          plantInvasive: invasive
            ? { list: invasive.list, recommendedAction: invasive.recommendedAction }
            : null,
        };
      }),
    };
  }

  /**
   * The owner of whatever this request creates or touches.
   *
   * Guests reach these routes with a guest token rather than a `guestId`
   * parameter, so the caller no longer chooses whose data this is. The row for
   * a guest is still created lazily, on their first write.
   */
  private async resolveOwner(user: AuthenticatedUser): Promise<string> {
    if (user.isGuest) {
      const guest = await this.userService.findOrCreateGuest(user.userId);
      return guest.id;
    }
    return user.userId;
  }

  @Post()
  @HttpCode(202)
  @UseGuards(GuestOrUserAuthGuard)
  @RequireApiKeyScope('write:spots')
  @ApiSecurity('ApiKey')
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
    const pickedUp = body.pickedUp === undefined ? true : body.pickedUp !== 'false';
    const cleanupId = body.cleanupId?.trim() || null;
    const cleanupDateId = body.cleanupDateId?.trim() || null;
    const subjectKindRaw = body.subjectKind?.trim();
    const subjectKind: 'litter' | 'plant' = subjectKindRaw === 'plant' ? 'plant' : 'litter';

    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }

    // It becomes part of the S3 key, so it has to be the uuid the client
    // already sends and not an arbitrary string.
    if (!UUID_PATTERN.test(uploadId)) {
      throw new BadRequestException('uploadId must be a UUID');
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

    // Trusting the declared Content-Type meant the stored object's type and
    // extension came from the uploader. Read the container instead.
    const detectedMime = await detectImageMime(image.buffer);
    if (!detectedMime) {
      throw new BadRequestException('image must be a JPEG, PNG, WebP or HEIC photo');
    }

    const userId = await this.resolveOwner((req as any).user);

    const result = await this.spotService.createSpot({
      userId,
      uploadId,
      imageBuffer: image.buffer,
      thumbnailBuffer: thumbnail?.buffer || null,
      mimeType: detectedMime,
      capturedAt,
      latitude,
      longitude,
      accuracyMeters: accuracy,
      pickedUp,
      cleanupId,
      cleanupDateId,
      subjectKind,
      sourceApiKeyId: (req as any).apiKey?.id ?? null,
    });

    return {
      spotId: result.spot.id,
      status: result.spot.processing_status,
      ...(result.warning ? { warning: result.warning } : {}),
    };
  }

  @Get(':id')
  @UseGuards(GuestOrUserAuthGuard)
  async getSpotStatus(
    @Param('id', ParseUUIDPipe) spotId: string,
    @Req() req: any,
  ): Promise<SpotDto> {
    const spot = await this.spotService.getSpotStatus(spotId, req.user.userId);
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
  @UseGuards(GuestOrUserAuthGuard)
  async listSpots(
    @Req() req: any,
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

    const page = await this.spotService.listSpotsForUser(
      req.user.userId,
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
  @UseGuards(GuestOrUserAuthGuard)
  async retryDetection(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ): Promise<{ status: string }> {
    await this.spotService.retryDetection(id, req.user.userId);
    return { status: PROCESSING_STATUS.QUEUED };
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(GuestOrUserAuthGuard)
  async deleteSpot(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ): Promise<void> {
    await this.spotService.deleteSpot(id, req.user.userId);
  }

  @Patch(':id')
  @UseGuards(GuestOrUserAuthGuard)
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
    @Req() req: any,
  ): Promise<SpotDto> {
    const userId = req.user.userId;

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

  // Marks detections as reviewed by a steward, which is what the model
  // agreement rate on the review page is computed from. Any signed-in user
  // could do it, so anyone could quietly corrupt that measurement.
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':spotId/confirm-detection')
  async confirmDetection(@Param('spotId', ParseUUIDPipe) spotId: string, @Req() req: any) {
    return this.spotService.confirmDetection(spotId, req.user.userId);
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

  @Get(':id/image')
  @UseGuards(OptionalJwtAuthGuard)
  async getOriginalImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.spotService.getOriginalStream(id, req.user?.userId ?? null);
    if (!result) throw new NotFoundException('Original image not available');
    res.set({
      'Content-Type': result.contentType,
      // Unlike the thumbnail, this body depends on who is asking and stops
      // existing once the original is purged — so it is neither shared-cacheable
      // nor immutable.
      'Cache-Control': 'private, max-age=3600',
      Vary: 'Authorization',
    });
    return new StreamableFile(result.body as any);
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
