import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LabelController } from './label.controller';
import { LabelService } from './label.service';
import { LabelSeedService } from './label-seed.service';
import { Label } from './label.entity';
import { LabelTranslation } from './label-translation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Label, LabelTranslation])],
  controllers: [LabelController],
  providers: [LabelService, LabelSeedService],
  exports: [LabelService],
})
export class LabelModule {}
