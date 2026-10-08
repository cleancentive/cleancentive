import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminOpsService } from './admin-ops.service';

const defaultDetailLimit = 10;
const maxDetailLimit = 50;
const defaultRetryBatchSize = 10;
const maxRetryBatchSize = 100;
// A finite batch with a visible end, rather than an infinite scroll — that is
// what keeps a review session from feeling like a chore.
const defaultReviewBatchSize = 10;
const maxReviewBatchSize = 50;

@ApiTags('admin-ops')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/ops')
export class AdminOpsController {
  constructor(private readonly adminOpsService: AdminOpsService) {}

  @Get('review/queue')
  @ApiOperation({ summary: 'Get the next batch of spots awaiting steward review' })
  @ApiQuery({ name: 'limit', required: false, description: `Spots to return (default ${defaultReviewBatchSize}, max ${maxReviewBatchSize})` })
  @ApiOkResponse({ description: 'Returns the oldest unreviewed completed litter spots with their detected items.' })
  async getReviewQueue(@Query('limit') limit?: string) {
    const parsed = parseInt(limit ?? '', 10);
    const resolved = Number.isNaN(parsed) ? defaultReviewBatchSize : Math.min(Math.max(parsed, 1), maxReviewBatchSize);
    return this.adminOpsService.getReviewQueue(resolved);
  }

  @Get('review/stats')
  @ApiOperation({ summary: 'Get review backlog, team progress and model agreement for the review page' })
  @ApiOkResponse({ description: 'Returns backlog size, weekly progress, active days, and model agreement rate.' })
  async getReviewStats(@Req() req: any) {
    return this.adminOpsService.getReviewStats(req.user.userId);
  }

  @Post('queue/clean-orphaned-failed')
  @ApiOperation({ summary: 'Remove failed-queue entries whose job data no longer exists (keeps genuine failures)' })
  @ApiOkResponse({ description: 'Returns how many entries were scanned, removed and kept.' })
  async cleanOrphanedFailedJobs() {
    return this.adminOpsService.cleanOrphanedFailedJobs();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get lightweight operations overview for dashboards and CLI checks' })
  @ApiOkResponse({ description: 'Returns lightweight queue, spot, worker, and health summary data.' })
  async getOverview() {
    return this.adminOpsService.getOverview();
  }

  @Get('queue')
  @ApiOperation({ summary: 'Get queue metrics and recent failed jobs' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of recent failed queue jobs to return. Defaults to 10.',
    example: defaultDetailLimit,
  })
  @ApiOkResponse({ description: 'Returns live BullMQ queue counts and recent failed jobs.' })
  async getQueue(@Query('limit') limit?: string) {
    return this.adminOpsService.getQueue(this.parseLimit(limit, defaultDetailLimit, maxDetailLimit));
  }

  @Get('spots')
  @ApiOperation({ summary: 'Get spot processing summary and recent failures' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of recent failed spots to return. Defaults to 10.',
    example: defaultDetailLimit,
  })
  @ApiOkResponse({ description: 'Returns durable spot status counts and recent failed spot records.' })
  async getSpots(@Query('limit') limit?: string) {
    return this.adminOpsService.getSpots(this.parseLimit(limit, defaultDetailLimit, maxDetailLimit));
  }

  @Get('worker')
  @ApiOperation({ summary: 'Get worker heartbeat and latest activity' })
  @ApiOkResponse({ description: 'Returns worker heartbeat, host metadata, and latest job activity timestamps.' })
  async getWorker() {
    return this.adminOpsService.getWorker();
  }

  @Get('health')
  @ApiOperation({ summary: 'Get dependency health checks for the processing pipeline' })
  @ApiOkResponse({ description: 'Returns health checks for backend dependencies and worker freshness.' })
  async getHealth() {
    return this.adminOpsService.getHealth();
  }

  @Get('storage')
  @ApiOperation({ summary: 'Get storage volume, breakdown, and growth rate' })
  @ApiOkResponse({ description: 'Returns storage summary, originals vs thumbnails breakdown, and weekly growth.' })
  async getStorage() {
    return this.adminOpsService.getStorageInsights();
  }

  @Get('purge')
  @ApiOperation({ summary: 'Get image purge status and statistics' })
  @ApiOkResponse({ description: 'Returns purge enabled/disabled state, retention config, run stats, and next-run estimates.' })
  async getPurge() {
    return this.adminOpsService.getPurgeStatus();
  }

  @Get('spot-stats')
  @ApiOperation({ summary: 'Get aggregate spot statistics including top categories and materials' })
  @ApiOkResponse({ description: 'Returns spot status breakdown, success rate, and top detected categories/materials.' })
  async getSpotStats() {
    return this.adminOpsService.getSpotAggregateStats();
  }

  @Delete('spots')
  @ApiOperation({ summary: 'Delete picks by user and/or team in a time range (steward backstop)' })
  @ApiOkResponse({ description: '`{ count }` for a dry run, otherwise `{ deleted, remaining }`; at most 500 per call.' })
  @ApiQuery({ name: 'user_id', required: false, description: 'Owner UUID; at least one of user_id and team_id' })
  @ApiQuery({ name: 'team_id', required: false, description: 'Team UUID; at least one of user_id and team_id' })
  @ApiQuery({ name: 'since', required: true, description: 'ISO 8601, inclusive' })
  @ApiQuery({ name: 'before', required: true, description: 'ISO 8601, exclusive' })
  @ApiQuery({ name: 'dry_run', required: false, description: 'true to count without deleting' })
  async deleteSpotsInRange(
    @Query('user_id') userId: string | undefined,
    @Query('team_id') teamId: string | undefined,
    @Query('since') since: string | undefined,
    @Query('before') before: string | undefined,
    @Query('dry_run') dryRun: string | undefined,
  ): Promise<{ count: number } | { deleted: number; remaining: number }> {
    const filter = {
      userId: userId || undefined,
      teamId: teamId || undefined,
      since: new Date(since ?? ''),
      before: new Date(before ?? ''),
    };
    if (dryRun === 'true') {
      return { count: await this.adminOpsService.countSpotsInRange(filter) };
    }
    return this.adminOpsService.deleteSpotsInRange(filter);
  }

  @Delete('spots/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Hard delete a spot, its detected items, and S3 images' })
  @ApiNoContentResponse({ description: 'Spot deleted successfully.' })
  async deleteSpot(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.adminOpsService.deleteSpot(id);
  }

  @Post('spots/retry-failed')
  @ApiOperation({ summary: 'Retry failed spots in bounded batches' })
  @ApiBody({
    description: 'Batch size for retrying failed spots. Defaults to 10 and is capped at 100.',
    schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', example: defaultRetryBatchSize, default: defaultRetryBatchSize },
      },
    },
  })
  @ApiOkResponse({ description: 'Returns a summary of queued and skipped failed spots.' })
  async retryFailedSpots(@Body('limit') limit?: number) {
    return this.adminOpsService.retryFailedSpots(this.parseLimit(String(limit ?? ''), defaultRetryBatchSize, maxRetryBatchSize));
  }

  private parseLimit(value: string | undefined, defaultValue: number, maxValue: number) {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return defaultValue;
    }

    return Math.min(parsed, maxValue);
  }
}
