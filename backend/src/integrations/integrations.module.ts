import { Module } from '@nestjs/common';
import { IntegrationQueueService, IntegrationWorkerService } from './integration-queue.service';
import { OutlineSyncModule } from '../outline-sync/outline-sync.module';

@Module({
  imports: [OutlineSyncModule],
  providers: [IntegrationQueueService, IntegrationWorkerService],
  exports: [IntegrationQueueService],
})
export class IntegrationsModule {}
