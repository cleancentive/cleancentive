import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CleanupService } from './cleanup.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../user/user.service';

type UploadFiles = {
  image?: Array<{ buffer: Buffer; mimetype: string; size: number }>;
  thumbnail?: Array<{ buffer: Buffer; mimetype: string; size: number }>;
};

interface CleanupItemDto {
  id: string;
  category: string | null;
  material: string | null;
  brand: string | null;
  weightGrams: number | null;
  confidence: number | null;
}

interface CleanupReportDto {
  id: string;
  status: string;
  teamId: string | null;
  eventId: string | null;
  eventOccurrenceId: string | null;
  capturedAt: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  processingError: string | null;
  analysisCompletedAt: Date | null;
  items: CleanupItemDto[];
}

@Controller('cleanup')
export class CleanupController {
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
    private readonly cleanupService: CleanupService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  private toReportDto(report: any): CleanupReportDto {
    return {
      id: report.id,
      status: report.processing_status,
      teamId: report.team_id,
      eventId: report.event_id,
      eventOccurrenceId: report.event_occurrence_id,
      capturedAt: report.captured_at,
      latitude: report.latitude,
      longitude: report.longitude,
      accuracyMeters: report.location_accuracy_meters,
      processingError: report.processing_error,
      analysisCompletedAt: report.analysis_completed_at,
      items: report.items.map((item: any) => ({
        id: item.id,
        category: item.category,
        material: item.material,
        brand: item.brand,
        weightGrams: item.weight_grams,
        confidence: item.confidence,
      })),
    };
  }

  private async resolveUserId(authHeader: string | undefined, guestId: string | undefined): Promise<string> {
    if (authHeader?.startsWith('Bearer ')) {
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

    if (!guestId) {
      throw new BadRequestException('guestId is required when not authenticated');
    }

    const guest = await this.userService.findOrCreateGuest(guestId);
    return guest.id;
  }

  @Post('uploads')
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
  async uploadCleanup(
    @UploadedFiles() files: UploadFiles,
    @Req() req: Request,
  ): Promise<{ reportId: string; status: string; warning?: string }> {
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

    const userId = await this.resolveUserId(req.headers.authorization, guestId);

    const result = await this.cleanupService.createUpload({
      userId,
      uploadId,
      imageBuffer: image.buffer,
      thumbnailBuffer: thumbnail?.buffer || null,
      mimeType: image.mimetype || 'image/jpeg',
      capturedAt,
      latitude,
      longitude,
      accuracyMeters: accuracy,
    });

    return {
      reportId: result.report.id,
      status: result.report.processing_status,
      ...(result.warning ? { warning: result.warning } : {}),
    };
  }

  @Get('uploads/:id')
  async getUploadStatus(
    @Param('id') reportId: string,
    @Req() req: Request,
    @Query('guestId') guestId?: string,
  ): Promise<CleanupReportDto> {
    let report;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      const userId = await this.resolveUserId(req.headers.authorization, undefined);
      report = await this.cleanupService.getUploadStatus(reportId, userId);
    } else {
      if (!guestId) {
        throw new BadRequestException('guestId is required when not authenticated');
      }
      report = await this.cleanupService.getUploadStatusForGuest(reportId, guestId);
    }

    return this.toReportDto(report);
  }

  @Get('reports')
  async listUploads(
    @Req() req: Request,
    @Query('guestId') guestId?: string,
    @Query('limit') limitQuery?: string,
  ): Promise<{ reports: CleanupReportDto[] }> {
    const parsedLimit = parseInt(limitQuery || '20', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20;

    const reports = req.headers.authorization?.startsWith('Bearer ')
      ? await this.cleanupService.listUploadsForUser(
        await this.resolveUserId(req.headers.authorization, undefined),
        limit,
      )
      : await this.cleanupService.listUploadsForGuest(
        await this.resolveUserId(undefined, guestId),
        limit,
      );

    return {
      reports: reports.map((report) => this.toReportDto(report)),
    };
  }

  @Post('reports/:id/retry')
  @HttpCode(202)
  async retryAnalysis(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('guestId') guestId?: string,
  ): Promise<{ status: string }> {
    const userId = await this.resolveUserId(req.headers.authorization, guestId);
    await this.cleanupService.retryAnalysis(id, userId);
    return { status: 'queued' };
  }

  @Get('reports/:id/thumbnail')
  async getThumbnail(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.cleanupService.getThumbnailStream(id);
    if (!result) throw new NotFoundException('Thumbnail not available');
    res.set({ 'Content-Type': result.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' });
    return new StreamableFile(result.body as any);
  }
}
