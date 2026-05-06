import { Body, Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OutlineSyncService } from './outline-sync.service';

@ApiTags('outline-maintenance')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('outline-maintenance')
export class OutlineMaintenanceController {
  constructor(private readonly outlineSyncService: OutlineSyncService) {}

  @Post('wipe-content')
  @ApiOperation({ summary: 'Wipe Outline content while preserving users, auth, and integrations' })
  @ApiBody({ schema: { type: 'object', properties: { confirmation: { type: 'string', example: 'WIPE_OUTLINE_CONTENT' } } } })
  @ApiOkResponse({ description: 'Returns counts for wiped Outline and Cleancentive rows.' })
  async wipeContent(@Body() body: { confirmation?: string }) {
    if (body?.confirmation !== 'WIPE_OUTLINE_CONTENT') {
      throw new BadRequestException('Confirmation must be WIPE_OUTLINE_CONTENT');
    }
    return this.outlineSyncService.wipeOutlineContentOnce(body.confirmation);
  }

  @Post('initialize-content')
  @ApiOperation({ summary: 'Initialize baseline Outline collections and team content' })
  @ApiOkResponse({ description: 'Returns counts for initialized Outline collections and mappings.' })
  async initializeContent() {
    return this.outlineSyncService.initializeOutlineContentOnce();
  }
}
