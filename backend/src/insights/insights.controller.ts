import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InsightsService } from './insights.service';

@ApiTags('insights')
@Controller('insights')
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get public community statistics' })
  @ApiOkResponse({ description: 'Returns aggregate stats and time series for cleanups, users, teams, spots, and items.' })
  async getStats() {
    return this.insightsService.getPublicStats();
  }
}
