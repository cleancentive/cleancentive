import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { EmailModule } from '../email/email.module';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';
import { PendingAuthRequest } from './pending-auth-request.entity';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
      signOptions: { expiresIn: '365d' },
    }),
    TypeOrmModule.forFeature([PendingAuthRequest]),
    EmailModule,
    UserModule,
    AdminModule,
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}