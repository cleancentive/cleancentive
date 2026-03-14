import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CleanupService } from './cleanup.service';
import { AdminService } from '../admin/admin.service';

@Controller('cleanups')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard)
export class CleanupController {
  constructor(
    private readonly cleanupService: CleanupService,
    private readonly adminService: AdminService,
  ) {}

  @Post()
  async createCleanup(
    @Request() req: any,
    @Body()
    body: {
      name?: string;
      description?: string;
      date?: {
        startAt?: string;
        endAt?: string;
        latitude?: number;
        longitude?: number;
        locationName?: string;
      };
    },
  ) {
    return this.cleanupService.createCleanup(req.user.userId, {
      name: body.name || '',
      description: body.description || '',
      date: {
        startAt: new Date(body.date?.startAt || ''),
        endAt: new Date(body.date?.endAt || ''),
        latitude: Number(body.date?.latitude),
        longitude: Number(body.date?.longitude),
        locationName: body.date?.locationName,
      },
    });
  }

  @Get('search')
  async searchCleanups(
    @Request() req: any,
    @Query('q') query?: string,
    @Query('status') status?: 'past' | 'ongoing' | 'future',
    @Query('date') date?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const isPlatformAdmin = await this.adminService.isAdmin(req.user.userId);
    return this.cleanupService.searchCleanups({
      query,
      status,
      date: date ? new Date(date) : undefined,
      includeArchived: includeArchived === 'true',
      currentUserIsPlatformAdmin: isPlatformAdmin,
    });
  }

  @Get('similar')
  async getSimilarCleanups(
    @Query('name') name?: string,
    @Query('startAt') startAt?: string,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
  ) {
    return this.cleanupService.findSimilarCleanups({
      name: name || '',
      startAt: startAt ? new Date(startAt) : undefined,
      latitude: latitude !== undefined ? Number(latitude) : undefined,
      longitude: longitude !== undefined ? Number(longitude) : undefined,
    });
  }

  @Get(':id')
  async getCleanup(@Param('id', ParseUUIDPipe) cleanupId: string) {
    return this.cleanupService.getCleanup(cleanupId);
  }

  @Post(':id/join')
  async joinCleanup(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupId: string) {
    return this.cleanupService.joinCleanup(cleanupId, req.user.userId);
  }

  @Post(':id/leave')
  async leaveCleanup(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupId: string) {
    return this.cleanupService.leaveCleanup(cleanupId, req.user.userId);
  }

  @Post(':id/dates')
  async addDate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupId: string,
    @Body()
    body: {
      startAt?: string;
      endAt?: string;
      latitude?: number;
      longitude?: number;
      locationName?: string;
    },
  ) {
    return this.cleanupService.addDate(cleanupId, req.user.userId, {
      startAt: new Date(body.startAt || ''),
      endAt: new Date(body.endAt || ''),
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      locationName: body.locationName,
    });
  }

  @Post('dates/:id/activate')
  async activateDate(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupDateId: string) {
    return this.cleanupService.activateDate(cleanupDateId, req.user.userId);
  }

  @Delete('dates/active')
  async deactivateDate(@Request() req: any): Promise<{ success: boolean }> {
    await this.cleanupService.deactivateDate(req.user.userId);
    return { success: true };
  }

  @Post(':id/participants/:userId/promote')
  async promoteParticipant(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ success: boolean }> {
    await this.cleanupService.promoteParticipant(cleanupId, userId, req.user.userId);
    return { success: true };
  }

  @Post(':id/archive')
  async archiveCleanup(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupId: string): Promise<{ success: boolean }> {
    await this.cleanupService.archiveCleanup(cleanupId, req.user.userId);
    return { success: true };
  }

  @Get(':id/messages')
  async listMessages(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupId: string) {
    return this.cleanupService.listMessages(cleanupId, req.user.userId);
  }

  @Post(':id/messages')
  async createMessage(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupId: string,
    @Body() body: { audience?: 'members' | 'admins'; subject?: string; body?: string },
  ) {
    const message = await this.cleanupService.createMessage({
      cleanupId,
      authorUserId: req.user.userId,
      audience: body.audience || 'members',
      subject: body.subject || '',
      body: body.body || '',
    });

    return {
      message,
      disclosure: 'Platform admins can read team and cleanup messages.',
    };
  }
}
