import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { AdminService } from '../admin/admin.service';
import { FeedbackService } from './feedback.service';
import {
  FEEDBACK_CATEGORY_QUERY_VALUES,
  FEEDBACK_STATUSES,
  normalizeFeedbackListQuery,
} from './feedback-query';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    throw new HttpException('Too many feedback submissions. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
  entry.count++;
}

const VALID_CATEGORIES = ['bug', 'suggestion', 'question'] as const;
type Category = (typeof VALID_CATEGORIES)[number];

const VALID_STATUSES = ['new', 'acknowledged', 'in_progress', 'resolved'] as const;
type Status = (typeof VALID_STATUSES)[number];

@Controller('feedback')
@ApiBearerAuth('Bearer')
@ApiTags('feedback')
export class FeedbackController {
  constructor(
    private readonly feedbackService: FeedbackService,
    private readonly adminService: AdminService,
  ) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Request() req: any,
    @Body() body: {
      category?: string;
      description?: string;
      contactEmail?: string;
      guestId?: string;
      errorContext?: { url?: string; message?: string; userAgent?: string; stack?: string };
    },
  ) {
    if (!body.category || !VALID_CATEGORIES.includes(body.category as Category)) {
      throw new BadRequestException('category must be one of: bug, suggestion, question');
    }
    if (!body.description?.trim() || body.description.trim().length < 10) {
      throw new BadRequestException('description must be at least 10 characters');
    }

    const rateLimitKey = req.user?.userId || req.ip || 'anonymous';
    checkRateLimit(rateLimitKey);

    return this.feedbackService.create({
      category: body.category as Category,
      description: body.description.trim(),
      contactEmail: body.contactEmail?.trim(),
      userId: req.user?.userId,
      guestId: body.guestId,
      errorContext: body.errorContext,
    });
  }

  @Get('mine')
  @UseGuards(OptionalJwtAuthGuard)
  async getMyFeedback(
    @Request() req: any,
    @Query('guestId') guestId?: string,
  ) {
    if (req.user?.userId) {
      return this.feedbackService.findByUser(req.user.userId);
    }
    if (guestId) {
      return this.feedbackService.findByGuest(guestId);
    }
    return [];
  }

  @Get('counts')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Count feedback items grouped by status' })
  async counts(): Promise<Record<string, number>> {
    return this.feedbackService.countByStatus();
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async getOne(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('guestId') guestId?: string,
  ) {
    const feedback = await this.feedbackService.findOne(id);

    // Check ownership unless admin
    const isAdmin = req.user?.userId ? await this.adminService.isAdmin(req.user.userId) : false;
    if (!isAdmin) {
      this.feedbackService.assertOwnership(feedback, req.user?.userId, guestId);
    }

    return feedback;
  }

  @Post(':id/responses')
  @UseGuards(OptionalJwtAuthGuard)
  async addResponse(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { message?: string; guestId?: string },
  ) {
    if (!body.message?.trim() || body.message.trim().length < 2) {
      throw new BadRequestException('message is required');
    }

    const isAdmin = req.user?.userId ? await this.adminService.isAdmin(req.user.userId) : false;

    if (!isAdmin) {
      const feedback = await this.feedbackService.findOne(id);
      this.feedbackService.assertOwnership(feedback, req.user?.userId, body.guestId);
    }

    return this.feedbackService.addResponse(id, body.message.trim(), isAdmin, req.user?.userId);
  }

  // ── Admin endpoints ──

  @Get()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'List feedback for stewards with sensible defaults for triage' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Comma-separated list of statuses (OR logic). Omit to return all. Valid values: new, acknowledged, in_progress, resolved.',
    example: 'new,acknowledged',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: FEEDBACK_CATEGORY_QUERY_VALUES,
    description: 'Defaults to all categories.',
    example: 'all',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based page number. Defaults to 1.',
    example: 1,
  })
  async findAll(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
  ) {
    return this.feedbackService.findAll(normalizeFeedbackListQuery({ status, category, page }));
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: string },
  ) {
    if (!body.status || !VALID_STATUSES.includes(body.status as Status)) {
      throw new BadRequestException('status must be one of: new, acknowledged, in_progress, resolved');
    }
    return this.feedbackService.updateStatus(id, body.status as Status);
  }
}
