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
import { EventService } from './event.service';
import { AdminService } from '../admin/admin.service';

@Controller('events')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard)
export class EventController {
  constructor(
    private readonly eventService: EventService,
    private readonly adminService: AdminService,
  ) {}

  @Post()
  async createEvent(
    @Request() req: any,
    @Body()
    body: {
      name?: string;
      description?: string;
      occurrence?: {
        startAt?: string;
        endAt?: string;
        latitude?: number;
        longitude?: number;
        locationName?: string;
      };
    },
  ) {
    return this.eventService.createEvent(req.user.userId, {
      name: body.name || '',
      description: body.description || '',
      occurrence: {
        startAt: new Date(body.occurrence?.startAt || ''),
        endAt: new Date(body.occurrence?.endAt || ''),
        latitude: Number(body.occurrence?.latitude),
        longitude: Number(body.occurrence?.longitude),
        locationName: body.occurrence?.locationName,
      },
    });
  }

  @Get()
  async searchEvents(
    @Request() req: any,
    @Query('q') query?: string,
    @Query('status') status?: 'past' | 'ongoing' | 'future',
    @Query('date') date?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const isPlatformAdmin = await this.adminService.isAdmin(req.user.userId);
    return this.eventService.searchEvents({
      query,
      status,
      date: date ? new Date(date) : undefined,
      includeArchived: includeArchived === 'true',
      currentUserIsPlatformAdmin: isPlatformAdmin,
    });
  }

  @Get('similar')
  async getSimilarEvents(
    @Query('name') name?: string,
    @Query('startAt') startAt?: string,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
  ) {
    return this.eventService.findSimilarEvents({
      name: name || '',
      startAt: startAt ? new Date(startAt) : undefined,
      latitude: latitude !== undefined ? Number(latitude) : undefined,
      longitude: longitude !== undefined ? Number(longitude) : undefined,
    });
  }

  @Get(':id')
  async getEvent(@Param('id', ParseUUIDPipe) eventId: string) {
    return this.eventService.getEvent(eventId);
  }

  @Post(':id/join')
  async joinEvent(@Request() req: any, @Param('id', ParseUUIDPipe) eventId: string) {
    return this.eventService.joinEvent(eventId, req.user.userId);
  }

  @Post(':id/leave')
  async leaveEvent(@Request() req: any, @Param('id', ParseUUIDPipe) eventId: string) {
    return this.eventService.leaveEvent(eventId, req.user.userId);
  }

  @Post(':id/occurrences')
  async addOccurrence(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body()
    body: {
      startAt?: string;
      endAt?: string;
      latitude?: number;
      longitude?: number;
      locationName?: string;
    },
  ) {
    return this.eventService.addOccurrence(eventId, req.user.userId, {
      startAt: new Date(body.startAt || ''),
      endAt: new Date(body.endAt || ''),
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      locationName: body.locationName,
    });
  }

  @Post('occurrences/:id/activate')
  async activateOccurrence(@Request() req: any, @Param('id', ParseUUIDPipe) occurrenceId: string) {
    return this.eventService.activateOccurrence(occurrenceId, req.user.userId);
  }

  @Delete('occurrences/active')
  async deactivateOccurrence(@Request() req: any): Promise<{ success: boolean }> {
    await this.eventService.deactivateOccurrence(req.user.userId);
    return { success: true };
  }

  @Post(':id/participants/:userId/promote')
  async promoteParticipant(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ success: boolean }> {
    await this.eventService.promoteParticipant(eventId, userId, req.user.userId);
    return { success: true };
  }

  @Post(':id/archive')
  async archiveEvent(@Request() req: any, @Param('id', ParseUUIDPipe) eventId: string): Promise<{ success: boolean }> {
    await this.eventService.archiveEvent(eventId, req.user.userId);
    return { success: true };
  }

  @Get(':id/messages')
  async listMessages(@Request() req: any, @Param('id', ParseUUIDPipe) eventId: string) {
    return this.eventService.listMessages(eventId, req.user.userId);
  }

  @Post(':id/messages')
  async createMessage(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body() body: { audience?: 'members' | 'admins'; subject?: string; body?: string },
  ) {
    const message = await this.eventService.createMessage({
      eventId,
      authorUserId: req.user.userId,
      audience: body.audience || 'members',
      subject: body.subject || '',
      body: body.body || '',
    });

    return {
      message,
      disclosure: 'Platform admins can read team and event messages.',
    };
  }
}
