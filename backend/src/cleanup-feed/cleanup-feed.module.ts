import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleanupFeed } from './cleanup-feed.entity';
import { CleanupFeedService } from './cleanup-feed.service';
import { CleanupFeedScheduler } from './cleanup-feed.scheduler';
import { CleanupFeedController } from './cleanup-feed.controller';
import { Geocoder } from './geocoder';
import { Cleanup } from '../cleanup/cleanup.entity';
import { CleanupDate } from '../cleanup/cleanup-date.entity';
import { CleanupParticipant } from '../cleanup/cleanup-participant.entity';
import { Team } from '../team/team.entity';
import { TeamMembership } from '../team/team-membership.entity';
import { UserEmail } from '../user/user-email.entity';
import { CleanupModule } from '../cleanup/cleanup.module';
import { AdminModule } from '../admin/admin.module';
import { EmailModule } from '../email/email.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CleanupFeed, Cleanup, CleanupDate, CleanupParticipant, Team, TeamMembership, UserEmail]),
    CleanupModule,
    AdminModule,
    EmailModule,
    CalendarModule,
  ],
  providers: [
    CleanupFeedService,
    CleanupFeedScheduler,
    // Its constructor arguments are test seams (fetch, redis, pacing), not
    // injectables — so it is built here rather than resolved.
    { provide: Geocoder, useFactory: () => new Geocoder() },
  ],
  controllers: [CleanupFeedController],
  exports: [CleanupFeedService],
})
export class CleanupFeedModule {}
