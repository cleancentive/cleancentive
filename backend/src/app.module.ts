import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from './user/user.entity';
import { UserEmail } from './user/user-email.entity';
import { Admin } from './admin/admin.entity';
import { PendingAuthRequest } from './auth/pending-auth-request.entity';
import { UserModule } from './user/user.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';

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
      entities: [User, UserEmail, Admin, PendingAuthRequest],
      synchronize: process.env.NODE_ENV !== 'production',
      migrations: ['dist/migrations/*.js'],
    }),
    UserModule,
    EmailModule,
    AuthModule,
    AdminModule,
  ],
})
export class AppModule {}