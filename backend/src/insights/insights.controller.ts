import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InsightsService } from './insights.service';

@ApiTags('insights')
@Controller('insights')
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get community statistics, optionally filtered by team, cleanup date, or time range' })
  @ApiOkResponse({ description: 'Returns aggregate stats and time series for cleanups, users, teams, spots, and items.' })
  @ApiQuery({ name: 'team_id', required: false, description: 'Filter by team UUID' })
  @ApiQuery({ name: 'cleanup_date_id', required: false, description: 'Filter by cleanup date UUID' })
  @ApiQuery({ name: 'since', required: false, description: 'Filter spots captured on or after this ISO 8601 date' })
  async getStats(
    @Query('team_id') teamId?: string,
    @Query('cleanup_date_id') cleanupDateId?: string,
    @Query('since') since?: string,
  ) {
    return this.insightsService.getPublicStats({ teamId, cleanupDateId, since });
  }
}
