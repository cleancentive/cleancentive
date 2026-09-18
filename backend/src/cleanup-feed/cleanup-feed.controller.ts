import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { CleanupFeedService } from './cleanup-feed.service';
import { CleanupFeedScheduler } from './cleanup-feed.scheduler';
import { CLEANUP_FEED_KINDS } from './adapters/registry';
import type { CleanupFeedSettings } from './cleanup-feed.entity';

/** Feeds are platform plumbing, so stewards register them — not team organizers. */
@Controller('teams/:teamId/feeds')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('Bearer')
@ApiTags('cleanup-feeds')
export class CleanupFeedController {
  constructor(
    private readonly feedService: CleanupFeedService,
    private readonly scheduler: CleanupFeedScheduler,
  ) {}

  @Get()
  async listFeeds(@Param('teamId', ParseUUIDPipe) teamId: string) {
    const feeds = await this.feedService.listFeeds(teamId);
    return {
      feeds,
      availableKinds: CLEANUP_FEED_KINDS,
      schedulerEnabled: this.scheduler.isEnabled(),
      nextRunAt: await this.scheduler.getNextRunAt(),
    };
  }

  @Post()
  async createFeed(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() body: { kind?: string; url?: string; settings?: Partial<CleanupFeedSettings>; enabled?: boolean },
  ) {
    return this.feedService.createFeed(teamId, {
      kind: body.kind || '',
      url: body.url || '',
      settings: body.settings,
      enabled: body.enabled,
    });
  }

  @Put(':feedId')
  async updateFeed(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('feedId', ParseUUIDPipe) feedId: string,
    @Body() body: { url?: string; settings?: Partial<CleanupFeedSettings>; enabled?: boolean },
  ) {
    return this.feedService.updateFeed(teamId, feedId, body);
  }

  @Delete(':feedId')
  @HttpCode(204)
  async deleteFeed(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('feedId', ParseUUIDPipe) feedId: string,
  ): Promise<void> {
    await this.feedService.deleteFeed(teamId, feedId);
  }

  /**
   * Queues a refresh — 202, not 200. A first run walks a source politely and
   * takes far longer than a request should, and running it inline would stamp
   * the steward's id on everything it writes.
   */
  @Post(':feedId/refresh')
  @HttpCode(202)
  async refreshFeed(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('feedId', ParseUUIDPipe) feedId: string,
    @Body() body: { dryRun?: boolean },
  ) {
    await this.feedService.getFeedOrThrow(teamId, feedId);
    if (!this.scheduler.isEnabled()) {
      throw new ConflictException('Cleanup feeds are disabled on this server');
    }
    const dryRun = body?.dryRun === true;
    await this.scheduler.requestRefresh(feedId, dryRun);
    return { queued: true, dryRun };
  }

  @Get(':feedId/preview')
  async getPreview(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('feedId', ParseUUIDPipe) feedId: string,
  ) {
    await this.feedService.getFeedOrThrow(teamId, feedId);
    return this.scheduler.getPreview(feedId);
  }
}
