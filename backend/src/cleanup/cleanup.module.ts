import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleanupController } from './cleanup.controller';
import { CleanupService } from './cleanup.service';
import { CleanupReport } from './cleanup-report.entity';
import { LitterItem } from './litter-item.entity';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [TypeOrmModule.forFeature([CleanupReport, LitterItem]), AuthModule, UserModule],
  controllers: [CleanupController],
  providers: [CleanupService],
  exports: [CleanupService, TypeOrmModule],
})
export class CleanupModule {}
