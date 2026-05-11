import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cleanup } from '../cleanup/cleanup.entity';
import { CleanupDate } from '../cleanup/cleanup-date.entity';
import { CleanupParticipant } from '../cleanup/cleanup-participant.entity';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { CalendarFeedController } from './calendar-feed.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Cleanup, CleanupDate, CleanupParticipant, User, UserEmail])],
  providers: [CalendarService],
  controllers: [CalendarController, CalendarFeedController],
  exports: [CalendarService],
})
export class CalendarModule {}
