import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from './admin.entity';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { Spot } from '../spot/spot.entity';
import { DetectedItem } from '../spot/detected-item.entity';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';
import { StorageModule } from '../storage/storage.module';
import { PurgeModule } from '../purge/purge.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Admin, User, UserEmail, Spot, DetectedItem]),
    forwardRef(() => StorageModule),
    PurgeModule,
  ],
  providers: [AdminService, AdminGuard, AdminOpsService],
  controllers: [AdminController, AdminOpsController],
  exports: [AdminService],
})
export class AdminModule {}
