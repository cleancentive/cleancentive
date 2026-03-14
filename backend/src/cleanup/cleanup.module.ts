import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cleanup } from './cleanup.entity';
import { CleanupDate } from './cleanup-date.entity';
import { CleanupParticipant } from './cleanup-participant.entity';
import { CleanupMessage } from './cleanup-message.entity';
import { CleanupService } from './cleanup.service';
import { CleanupController } from './cleanup.controller';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { AdminModule } from '../admin/admin.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cleanup, CleanupDate, CleanupParticipant, CleanupMessage, User, UserEmail]),
    AdminModule,
    EmailModule,
  ],
  providers: [CleanupService],
  controllers: [CleanupController],
  exports: [CleanupService, TypeOrmModule],
})
export class CleanupModule {}
