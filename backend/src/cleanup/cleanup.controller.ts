import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CleanupService } from './cleanup.service';
import { AdminService } from '../admin/admin.service';

@Controller('cleanups')
@ApiBearerAuth('Bearer')
export class CleanupController {
  constructor(
    private readonly cleanupService: CleanupService,
    private readonly adminService: AdminService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(OptionalJwtAuthGuard)
  async searchCleanups(
    @Request() req: any,
    @Query('q') query?: string,
    @Query('status') status?: 'past' | 'ongoing' | 'future',
    @Query('date') date?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const userId = req.user?.userId;
    const isPlatformAdmin = userId ? await this.adminService.isAdmin(userId) : false;
    return this.cleanupService.searchCleanups({
      query,
      status,
      date: date ? new Date(date) : undefined,
      includeArchived: includeArchived === 'true',
      currentUserIsPlatformAdmin: isPlatformAdmin,
      userId,
    });
  }

  @Get('similar')
  @UseGuards(OptionalJwtAuthGuard)
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
  @UseGuards(OptionalJwtAuthGuard)
  async getCleanup(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupId: string,
  ) {
    return this.cleanupService.getCleanupDetail(cleanupId, req.user?.userId);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async updateCleanup(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupId: string,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.cleanupService.updateCleanup(cleanupId, req.user.userId, body);
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  async joinCleanup(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupId: string) {
    return this.cleanupService.joinCleanup(cleanupId, req.user.userId);
  }

  @Post(':id/leave')
  @UseGuards(JwtAuthGuard)
  async leaveCleanup(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupId: string) {
    return this.cleanupService.leaveCleanup(cleanupId, req.user.userId);
  }

  @Post(':id/dates')
  @UseGuards(JwtAuthGuard)
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

  @Post(':id/dates/bulk')
  @UseGuards(JwtAuthGuard)
  async addDatesBulk(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupId: string,
    @Body()
    body: {
      recurrenceId: string;
      dates: Array<{
        startAt?: string;
        endAt?: string;
        latitude?: number;
        longitude?: number;
        locationName?: string;
      }>;
    },
  ) {
    return this.cleanupService.addDatesBulk(cleanupId, req.user.userId, {
      recurrenceId: body.recurrenceId,
      dates: (body.dates || []).map((d) => ({
        startAt: new Date(d.startAt || ''),
        endAt: new Date(d.endAt || ''),
        latitude: Number(d.latitude),
        longitude: Number(d.longitude),
        locationName: d.locationName,
      })),
    });
  }

  @Delete(':id/dates/bulk')
  @UseGuards(JwtAuthGuard)
  async deleteDatesBulk(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupId: string,
    @Body() body: { dateIds: string[] },
  ): Promise<{ success: boolean }> {
    await this.cleanupService.deleteDatesBulk(cleanupId, req.user.userId, body.dateIds || []);
    return { success: true };
  }

  @Put('dates/:id')
  @UseGuards(JwtAuthGuard)
  async updateDate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupDateId: string,
    @Body()
    body: {
      startAt?: string;
      endAt?: string;
      latitude?: number;
      longitude?: number;
      locationName?: string;
    },
  ) {
    return this.cleanupService.updateDate(cleanupDateId, req.user.userId, {
      startAt: new Date(body.startAt || ''),
      endAt: new Date(body.endAt || ''),
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      locationName: body.locationName,
    });
  }

  @Delete('dates/active')
  @UseGuards(JwtAuthGuard)
  async deactivateDate(@Request() req: any): Promise<{ success: boolean }> {
    await this.cleanupService.deactivateDate(req.user.userId);
    return { success: true };
  }

  @Delete('dates/:id')
  @UseGuards(JwtAuthGuard)
  async deleteDate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupDateId: string,
  ): Promise<{ success: boolean }> {
    await this.cleanupService.deleteDate(cleanupDateId, req.user.userId);
    return { success: true };
  }

  @Post('dates/:id/activate')
  @UseGuards(JwtAuthGuard)
  async activateDate(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupDateId: string) {
    return this.cleanupService.activateDate(cleanupDateId, req.user.userId);
  }

  @Post(':id/participants/:userId/promote')
  @UseGuards(JwtAuthGuard)
  async promoteParticipant(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) cleanupId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ success: boolean }> {
    await this.cleanupService.promoteParticipant(cleanupId, userId, req.user.userId);
    return { success: true };
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  async archiveCleanup(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupId: string): Promise<{ success: boolean }> {
    await this.cleanupService.archiveCleanup(cleanupId, req.user.userId);
    return { success: true };
  }

  @Get(':id/messages')
  @UseGuards(JwtAuthGuard)
  async listMessages(@Request() req: any, @Param('id', ParseUUIDPipe) cleanupId: string) {
    return this.cleanupService.listMessages(cleanupId, req.user.userId);
  }

  @Post(':id/messages')
  @UseGuards(JwtAuthGuard)
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
