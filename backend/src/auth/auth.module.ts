import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PatStrategy } from './pat.strategy';
import { EmailModule } from '../email/email.module';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';
import { PersonalAccessTokenModule } from '../personal-access-token/personal-access-token.module';
import { PendingAuthRequest } from './pending-auth-request.entity';
import { DeviceCode } from './device-code.entity';
import { getJwtSecret, SESSION_TTL } from './jwt-config';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      // Async so the secret is read when the module is instantiated rather than
      // when the file is imported: a spec that imports a controller for its
      // metadata must not trip the production guard.
      useFactory: () => ({
        secret: getJwtSecret(),
        signOptions: { expiresIn: SESSION_TTL },
      }),
    }),
    TypeOrmModule.forFeature([PendingAuthRequest, DeviceCode]),
    EmailModule,
    UserModule,
    AdminModule,
    PersonalAccessTokenModule,
  ],
  providers: [AuthService, JwtStrategy, PatStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}