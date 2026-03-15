import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Spot } from '../spot/spot.entity';
import { PurgeService } from './purge.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([Spot]), StorageModule],
  providers: [PurgeService],
  exports: [PurgeService],
})
export class PurgeModule {}
