import { Controller, Delete, HttpCode, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { SpotService } from './spot.service';

/**
 * Steward deletion of spots. Lives next to SpotService rather than in the
 * admin module so the one deletion path (objects, queued job, row, event) is
 * shared without the admin module having to import the spot module.
 */
@Controller('admin/ops')
@ApiTags('admin')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SpotAdminController {
  constructor(private readonly spotService: SpotService) {}

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
      return { count: await this.spotService.countSpotsInRange(filter) };
    }
    return this.spotService.deleteSpotsInRange(filter);
  }

  @Delete('spots/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Hard delete a spot, its detected items, and S3 images' })
  @ApiNoContentResponse({ description: 'Spot deleted successfully.' })
  async deleteSpot(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.spotService.deleteSpotAsAdmin(id);
  }
}
