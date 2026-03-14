import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminOpsService } from './admin-ops.service';

const defaultDetailLimit = 10;
const maxDetailLimit = 50;
const defaultRetryBatchSize = 10;
const maxRetryBatchSize = 100;

@ApiTags('admin-ops')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/ops')
export class AdminOpsController {
  constructor(private readonly adminOpsService: AdminOpsService) {}

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
