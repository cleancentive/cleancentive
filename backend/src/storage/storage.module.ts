import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Spot } from '../spot/spot.entity';
import { StorageService } from './storage.service';
import { EmailModule } from '../email/email.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [TypeOrmModule.forFeature([Spot]), EmailModule, forwardRef(() => AdminModule)],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
