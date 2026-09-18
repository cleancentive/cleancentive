import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InsightsService } from './insights.service';
import { AdminService } from '../admin/admin.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

@ApiTags('insights')
@Controller('insights')
@UseGuards(OptionalJwtAuthGuard)
export class InsightsController {
  constructor(
    private readonly insightsService: InsightsService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * The "My picks" filter, and only that.
   *
   * Anyone could pass any user id here and get back every place that person
   * has logged a pick, as map points. Ids are public and team member lists put
   * a nickname next to them, so this turned a name into a location history.
   */
  private async assertOwnUserFilter(req: any, userId?: string): Promise<void> {
    if (!userId) return;
    const caller = req.user?.userId;
    if (caller && !req.user?.isGuest) {
      if (caller === userId) return;
      if (await this.adminService.isAdmin(caller)) return;
    } else if (caller === userId) {
      // A guest filtering their own picks.
      return;
    }
    throw new ForbiddenException('You can only filter insights by your own activity');
  }

  @Get('map')
  @ApiOperation({ summary: 'Get spot and cleanup locations as GeoJSON for map display' })
  @ApiOkResponse({ description: 'Returns GeoJSON FeatureCollections for spots and cleanup locations.' })
  @ApiQuery({ name: 'team_id', required: false, description: 'Filter by team UUID' })
  @ApiQuery({ name: 'cleanup_id', required: false, description: 'Filter by cleanup UUID (all dates of this cleanup)' })
  @ApiQuery({ name: 'cleanup_date_id', required: false, description: 'Filter by cleanup date UUID (takes precedence over cleanup_id)' })
  @ApiQuery({ name: 'since', required: false, description: 'Filter spots captured on or after this ISO 8601 date' })
  @ApiQuery({ name: 'picked_up', required: false, description: 'Filter by picked_up status (true or false)' })
  @ApiQuery({ name: 'user_id', required: false, description: 'Filter by user UUID (for "My" filter)' })
  @ApiQuery({ name: 'subject_kind', required: false, description: 'Filter by subject kind (litter or plant)' })
  async getMapData(
    @Req() req: any,
    @Query('team_id') teamId?: string,
    @Query('cleanup_id') cleanupId?: string,
    @Query('cleanup_date_id') cleanupDateId?: string,
    @Query('since') since?: string,
    @Query('picked_up') pickedUp?: string,
    @Query('user_id') userId?: string,
    @Query('subject_kind') subjectKind?: string,
  ) {
    await this.assertOwnUserFilter(req, userId);
    return this.insightsService.getMapData({
      teamId, cleanupId, cleanupDateId, since,
      pickedUp: this.parseBooleanParam(pickedUp),
      userId,
      subjectKind: subjectKind === 'plant' ? 'plant' : subjectKind === 'litter' ? 'litter' : undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get community statistics, optionally filtered by team, cleanup date, or time range' })
  @ApiOkResponse({ description: 'Returns aggregate stats and time series for cleanups, users, teams, spots, and items.' })
  @ApiQuery({ name: 'team_id', required: false, description: 'Filter by team UUID' })
  @ApiQuery({ name: 'cleanup_id', required: false, description: 'Filter by cleanup UUID (all dates of this cleanup)' })
  @ApiQuery({ name: 'cleanup_date_id', required: false, description: 'Filter by cleanup date UUID (takes precedence over cleanup_id)' })
  @ApiQuery({ name: 'since', required: false, description: 'Filter spots captured on or after this ISO 8601 date' })
  @ApiQuery({ name: 'picked_up', required: false, description: 'Filter by picked_up status (true or false)' })
  @ApiQuery({ name: 'user_id', required: false, description: 'Filter by user UUID (for "My" filter)' })
  async getStats(
    @Req() req: any,
    @Query('team_id') teamId?: string,
    @Query('cleanup_id') cleanupId?: string,
    @Query('cleanup_date_id') cleanupDateId?: string,
    @Query('since') since?: string,
    @Query('picked_up') pickedUp?: string,
    @Query('user_id') userId?: string,
  ) {
    await this.assertOwnUserFilter(req, userId);
    return this.insightsService.getPublicStats({
      teamId, cleanupId, cleanupDateId, since,
      pickedUp: this.parseBooleanParam(pickedUp),
      userId,
    });
  }

  private parseBooleanParam(value?: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }
}
