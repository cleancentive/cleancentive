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
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { SpotService } from './spot.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../user/user.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags } from '@nestjs/swagger';

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

interface SpotDto {
  id: string;
  status: string;
  teamId: string | null;
  cleanupId: string | null;
  cleanupDateId: string | null;
  capturedAt: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  pickedUp: boolean;
  processingError: string | null;
  detectionCompletedAt: Date | null;
  items: DetectedItemDto[];
}

@Controller('spots')
@ApiTags('spots')
export class SpotController {
  private readonly maxUploadSizeBytes = parseInt(process.env.UPLOAD_MAX_SIZE_BYTES || `${15 * 1024 * 1024}`, 10);
  private readonly maxAcceptedAccuracyMeters = parseFloat(
    process.env.LOCATION_MAX_ACCURACY_METERS || (process.env.NODE_ENV === 'development' ? '5000' : '200'),
  );
  private readonly disableAccuracyCheck =
    process.env.NODE_ENV === 'development' &&
    ['true', '1', 'yes', 'on'].includes((process.env.LOCATION_DISABLE_ACCURACY_CHECK || 'false').toLowerCase());

  private isLocalhostRequest(req: Request): boolean {
    const hostHeader = (req.headers.host || '').split(':')[0].toLowerCase();
    const origin = (req.headers.origin || '').toLowerCase();

    return (
      hostHeader === 'localhost' ||
      hostHeader === '127.0.0.1' ||
      hostHeader === '::1' ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1') ||
      origin.startsWith('http://[::1]')
    );
  }

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
    return {
      id: spot.id,
      status: spot.processing_status,
      teamId: spot.team_id,
      cleanupId: spot.cleanup_id,
      cleanupDateId: spot.cleanup_date_id,
      capturedAt: spot.captured_at,
      latitude: spot.latitude,
      longitude: spot.longitude,
      accuracyMeters: spot.location_accuracy_meters,
      pickedUp: spot.picked_up,
      processingError: spot.processing_error,
      detectionCompletedAt: spot.detection_completed_at,
      items: spot.items.map((item: any) => ({
        id: item.id,
        objectLabel: this.toLabelRef(item.object_label),
        materialLabel: this.toLabelRef(item.material_label),
        brandLabel: this.toLabelRef(item.brand_label),
        matchConfidence: item.match_confidence,
        humanVerified: item.human_verified,
        weightGrams: item.weight_grams,
        confidence: item.confidence,
      })),
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
      throw new BadRequestException(`image exceeds max size of ${this.maxUploadSizeBytes} bytes`);
    }

    const body = req.body as Record<string, string | undefined>;

    const uploadId = body.uploadId?.trim();
    const latitude = parseFloat(body.latitude || '');
    const longitude = parseFloat(body.longitude || '');
    const accuracy = parseFloat(body.accuracyMeters || '');
    const capturedAt = new Date(body.capturedAt || '');
    const guestId = body.guestId?.trim();
    const pickedUp = body.pickedUp === undefined ? true : body.pickedUp !== 'false';
    const cleanupId = body.cleanupId?.trim() || null;
    const cleanupDateId = body.cleanupDateId?.trim() || null;

    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('latitude and longitude are required numeric values');
    }

    if (!Number.isFinite(accuracy) || accuracy <= 0) {
      throw new BadRequestException('accuracyMeters is required and must be greater than 0');
    }

    const skipAccuracyCheck = this.disableAccuracyCheck || this.isLocalhostRequest(req);

    if (!skipAccuracyCheck && accuracy > this.maxAcceptedAccuracyMeters) {
      throw new BadRequestException(`location accuracy must be <= ${this.maxAcceptedAccuracyMeters} meters`);
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

  @Get()
  async listSpots(
    @Req() req: Request,
    @Query('guestId') guestId?: string,
    @Query('limit') limitQuery?: string,
    @Query('picked_up') pickedUpQuery?: string,
    @Query('since') sinceQuery?: string,
  ): Promise<{ spots: SpotDto[] }> {
    const parsedLimit = parseInt(limitQuery || '20', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20;

    const pickedUp = this.parseBooleanParam(pickedUpQuery);
    const since = sinceQuery && !Number.isNaN(new Date(sinceQuery).getTime()) ? sinceQuery : undefined;

    const spots = req.headers.authorization?.startsWith('Bearer ')
      ? await this.spotService.listSpotsForUser(
        await this.resolveAuthUserId(req.headers.authorization),
        limit,
        { pickedUp, since },
      )
      : await this.spotService.listSpotsForGuest(
        this.requireGuestId(guestId),
        limit,
        { pickedUp, since },
      );

    return {
      spots: spots.map((spot) => this.toSpotDto(spot)),
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
    return { status: 'queued' };
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
    @Body() body: { pickedUp?: boolean; cleanupId?: string; cleanupDateId?: string },
    @Req() req: Request,
    @Query('guestId') guestId?: string,
  ): Promise<SpotDto> {
    let userId: string;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      userId = await this.resolveAuthUserId(req.headers.authorization);
    } else {
      userId = this.requireGuestId(guestId);
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
