import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module';
import { Spot } from '../spot/spot.entity';
import { DetectedItem } from '../spot/detected-item.entity';
import { User } from '../user/user.entity';
import { Team } from '../team/team.entity';
import { Cleanup } from '../cleanup/cleanup.entity';
import { InsightsService } from './insights.service';
import { InsightsCacheService } from './insights-cache.service';
import { InsightsEventsService } from './insights-events.service';
import { InsightsController } from './insights.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Spot, DetectedItem, User, Team, Cleanup]), forwardRef(() => AdminModule)],
  providers: [InsightsService, InsightsCacheService, InsightsEventsService],
  controllers: [InsightsController],
  exports: [InsightsCacheService, InsightsEventsService],
})
export class InsightsModule {}
