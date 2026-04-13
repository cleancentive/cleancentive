import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RequestContextInterceptor } from './common/request-context.interceptor';
import { AuditSubscriber } from './common/audit.subscriber';
import { User } from './user/user.entity';
import { UserEmail } from './user/user-email.entity';
import { Admin } from './admin/admin.entity';
import { PendingAuthRequest } from './auth/pending-auth-request.entity';
import { DeviceCode } from './auth/device-code.entity';
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
import { TeamEmailPattern } from './team/team-email-pattern.entity';
import { TeamModule } from './team/team.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { StorageModule } from './storage/storage.module';
import { PurgeModule } from './purge/purge.module';
import { InsightsModule } from './insights/insights.module';
import { Feedback } from './feedback/feedback.entity';
import { FeedbackResponse } from './feedback/feedback-response.entity';
import { FeedbackModule } from './feedback/feedback.module';
import { Label } from './label/label.entity';
import { LabelTranslation } from './label/label-translation.entity';
import { DetectedItemEdit } from './spot/detected-item-edit.entity';
import { LabelModule } from './label/label.module';
import { OidcModule } from './oidc/oidc.module';
import { OidcAuthorizationCode, OidcRefreshToken, OidcClient } from './oidc/oidc.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
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
        DeviceCode,
        Spot,
        DetectedItem,
        Team,
        TeamMembership,
        TeamMessage,
        TeamEmailPattern,
        Cleanup,
        CleanupDate,
        CleanupParticipant,
        CleanupMessage,
        Feedback,
        FeedbackResponse,
        Label,
        LabelTranslation,
        DetectedItemEdit,
        OidcAuthorizationCode,
        OidcRefreshToken,
        OidcClient,
      ],
      subscribers: [AuditSubscriber],
      synchronize: false,
      migrationsRun: process.env.NODE_ENV !== 'test',
      migrations: [`${__dirname}/migrations/*.{ts,js}`],
    }),
    UserModule,
    EmailModule,
    AuthModule,
    AdminModule,
    SpotModule,
    TeamModule,
    CleanupModule,
    StorageModule,
    PurgeModule,
    InsightsModule,
    FeedbackModule,
    LabelModule,
    OidcModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule {}
