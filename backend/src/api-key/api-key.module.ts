import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module';
import { ApiKey } from './api-key.entity';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { UserApiKeyController } from './user-api-key.controller';
import { UserEmail } from '../user/user-email.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, UserEmail]), AdminModule],
  providers: [ApiKeyService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
  controllers: [ApiKeyController, UserApiKeyController],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
