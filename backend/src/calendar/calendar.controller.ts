import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CalendarService } from './calendar.service';

@Controller('calendar')
@ApiBearerAuth('Bearer')
@ApiTags('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('me/urls')
  @UseGuards(JwtAuthGuard)
  async getMyUrls(@Request() req: any): Promise<{
    joinedHttp: string;
    joinedWebcal: string;
    discoverHttp: string;
    discoverWebcal: string;
  }> {
    return this.calendarService.feedUrls(req.user.userId);
  }
}
