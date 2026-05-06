import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutlineSyncService } from './outline-sync.service';
import { OutlineWebhookController } from './outline-webhook.controller';
import { OutlineMaintenanceController } from './outline-maintenance.controller';
import { OutlineWebhookConfig } from './outline-webhook-config.entity';
import { OutlineEvent } from './outline-event.entity';
import { OutlineMaintenanceState } from './outline-maintenance-state.entity';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutlineWebhookConfig, OutlineEvent, OutlineMaintenanceState]),
    UserModule,
    AdminModule,
    TeamModule,
  ],
  providers: [OutlineSyncService],
  controllers: [OutlineWebhookController, OutlineMaintenanceController],
  exports: [OutlineSyncService],
})
export class OutlineSyncModule {}
