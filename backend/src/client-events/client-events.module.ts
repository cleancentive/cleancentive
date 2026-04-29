import { Module } from '@nestjs/common';
import { ClientEventsController } from './client-events.controller';
import { ClientEventsService } from './client-events.service';

@Module({
  controllers: [ClientEventsController],
  providers: [ClientEventsService],
})
export class ClientEventsModule {}
