import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Event } from './event.entity';
import { EventOccurrence } from './event-occurrence.entity';
import { EventParticipant } from './event-participant.entity';
import { EventMessage } from './event-message.entity';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { AdminModule } from '../admin/admin.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Event, EventOccurrence, EventParticipant, EventMessage, User, UserEmail]),
    AdminModule,
    EmailModule,
  ],
  providers: [EventService],
  controllers: [EventController],
  exports: [EventService, TypeOrmModule],
})
export class EventModule {}
