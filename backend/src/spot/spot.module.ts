import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpotController } from './spot.controller';
import { SpotService } from './spot.service';
import { Spot } from './spot.entity';
import { DetectedItem } from './detected-item.entity';
import { DetectedItemEdit } from './detected-item-edit.entity';
import { SpotEdit } from './spot-edit.entity';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { TeamModule } from '../team/team.module';
import { CleanupModule } from '../cleanup/cleanup.module';
import { LabelModule } from '../label/label.module';
import { AdminModule } from '../admin/admin.module';
import { InsightsModule } from '../insights/insights.module';

@Module({
  imports: [TypeOrmModule.forFeature([Spot, DetectedItem, DetectedItemEdit, SpotEdit]), AuthModule, UserModule, TeamModule, CleanupModule, LabelModule, forwardRef(() => AdminModule), forwardRef(() => InsightsModule)],
  controllers: [SpotController],
  providers: [SpotService],
  exports: [SpotService, TypeOrmModule],
})
export class SpotModule {}
