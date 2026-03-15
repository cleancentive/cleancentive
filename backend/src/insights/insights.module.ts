import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Spot } from '../spot/spot.entity';
import { DetectedItem } from '../spot/detected-item.entity';
import { User } from '../user/user.entity';
import { Team } from '../team/team.entity';
import { Cleanup } from '../cleanup/cleanup.entity';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Spot, DetectedItem, User, Team, Cleanup])],
  providers: [InsightsService],
  controllers: [InsightsController],
})
export class InsightsModule {}
