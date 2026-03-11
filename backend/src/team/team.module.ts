import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Team } from './team.entity';
import { TeamMembership } from './team-membership.entity';
import { TeamMessage } from './team-message.entity';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { AdminModule } from '../admin/admin.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [TypeOrmModule.forFeature([Team, TeamMembership, TeamMessage, User, UserEmail]), AdminModule, EmailModule],
  providers: [TeamService],
  controllers: [TeamController],
  exports: [TeamService, TypeOrmModule],
})
export class TeamModule {}
