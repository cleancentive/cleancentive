import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
}
