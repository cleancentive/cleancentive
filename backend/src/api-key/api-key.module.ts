import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module';
import { ApiKey } from './api-key.entity';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), AdminModule],
  providers: [ApiKeyService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
  controllers: [ApiKeyController],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
