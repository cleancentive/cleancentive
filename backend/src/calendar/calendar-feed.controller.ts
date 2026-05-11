import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CalendarService } from './calendar.service';

@Controller('calendar')
@ApiTags('calendar')
export class CalendarFeedController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get(':userId/joined.ics')
  async getJoinedFeed(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.calendarService.ensureUserExists(userId);
    const ics = await this.calendarService.buildJoinedFeed(userId);
    await this.calendarService.recordFeedFetch(userId);
    this.respondIcs(res, ics);
  }

  @Get(':userId/discover.ics')
  async getDiscoverFeed(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.calendarService.ensureUserExists(userId);
    const ics = await this.calendarService.buildDiscoverFeed(userId);
    await this.calendarService.recordFeedFetch(userId);
    this.respondIcs(res, ics);
  }

  @Get('cleanup-dates/:id.ics')
  async getCleanupDateIcs(
    @Param('id', ParseUUIDPipe) cleanupDateId: string,
    @Res() res: Response,
  ): Promise<void> {
    const ics = await this.calendarService.buildSingleEvent(cleanupDateId);
    this.respondIcs(res, ics);
  }

  private respondIcs(res: Response, ics: string): void {
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(ics);
  }
}
