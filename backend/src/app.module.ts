import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from './user/user.entity';
import { UserEmail } from './user/user-email.entity';
import { Admin } from './admin/admin.entity';
import { PendingAuthRequest } from './auth/pending-auth-request.entity';
import { Spot } from './spot/spot.entity';
import { DetectedItem } from './spot/detected-item.entity';
import { UserModule } from './user/user.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { SpotModule } from './spot/spot.module';
import { Team } from './team/team.entity';
import { TeamMembership } from './team/team-membership.entity';
import { TeamMessage } from './team/team-message.entity';
import { Cleanup } from './cleanup/cleanup.entity';
import { CleanupDate } from './cleanup/cleanup-date.entity';
import { CleanupParticipant } from './cleanup/cleanup-participant.entity';
import { CleanupMessage } from './cleanup/cleanup-message.entity';
import { TeamModule } from './team/team.module';
import { CleanupModule } from './cleanup/cleanup.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      username: process.env.DB_USERNAME || 'cleancentive',
      password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
      database: process.env.DB_DATABASE || 'cleancentive',
      entities: [
        User,
        UserEmail,
        Admin,
        PendingAuthRequest,
        Spot,
        DetectedItem,
        Team,
        TeamMembership,
        TeamMessage,
        Cleanup,
        CleanupDate,
        CleanupParticipant,
        CleanupMessage,
      ],
      synchronize: process.env.NODE_ENV !== 'production',
      migrations: ['dist/migrations/*.js'],
    }),
    UserModule,
    EmailModule,
    AuthModule,
    AdminModule,
    SpotModule,
    TeamModule,
    CleanupModule,
  ],
})
export class AppModule {}
