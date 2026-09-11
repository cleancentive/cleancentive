import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Spot } from '../spot/spot.entity';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [TypeOrmModule.forFeature([Spot])],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
