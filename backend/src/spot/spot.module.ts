import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpotController } from './spot.controller';
import { SpotService } from './spot.service';
import { Spot } from './spot.entity';
import { DetectedItem } from './detected-item.entity';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { TeamModule } from '../team/team.module';
import { CleanupModule } from '../cleanup/cleanup.module';

@Module({
  imports: [TypeOrmModule.forFeature([Spot, DetectedItem]), AuthModule, UserModule, TeamModule, CleanupModule],
  controllers: [SpotController],
  providers: [SpotService],
  exports: [SpotService, TypeOrmModule],
})
export class SpotModule {}
