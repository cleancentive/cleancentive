import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OidcService } from './oidc.service';
import { OidcController } from './oidc.controller';
import { OidcAuthorizationCode, OidcRefreshToken, OidcClient } from './oidc.entity';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
      signOptions: { expiresIn: '30m' },
    }),
    TypeOrmModule.forFeature([OidcAuthorizationCode, OidcRefreshToken, OidcClient]),
    AuthModule,
    UserModule,
  ],
  controllers: [OidcController],
  providers: [OidcService],
  exports: [OidcService],
})
export class OidcModule {}
