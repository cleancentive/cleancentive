import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SystemService } from './system.service';

@ApiTags('system')
@Controller()
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('version')
  @ApiOperation({ summary: 'Get deployed version information for backend, frontend, and worker (public)' })
  @ApiOkResponse({ description: 'Returns commit hash and build timestamp for each artifact.' })
  async getVersion() {
    return this.systemService.getVersion();
  }

  @Get('health/detection')
  @ApiOperation({
    summary: 'Whether litter detection is actually succeeding (public, for external uptime monitoring)',
  })
  @ApiOkResponse({ description: 'Detection is completing normally, or degraded but still working.' })
  @ApiServiceUnavailableResponse({ description: 'Detection is failing — returns 503 so an external monitor trips.' })
  async getDetectionHealth(@Res({ passthrough: true }) res: Response) {
    const health = await this.systemService.getDetectionHealth();
    // A monitor that only understands HTTP status still needs to see this, so a
    // hard down is a 503 rather than a 200 with a sad field in the body.
    res.status(health.status === 'down' ? 503 : 200);
    return health;
  }
}
