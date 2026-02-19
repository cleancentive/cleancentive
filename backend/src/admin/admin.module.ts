import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from './admin.entity';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Admin, User, UserEmail])],
  providers: [AdminService, AdminGuard],
  controllers: [AdminController],
  exports: [AdminService],
})
export class AdminModule {}
