import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from './user/user.entity';
import { UserEmail } from './user/user-email.entity';
import { UserService } from './user/user.service';
import { AuthService } from './auth/auth.service';
import { UserController } from './user/user.controller';
import { UserProfileController } from './user/user-profile.controller';
import { AuthController } from './auth/auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './auth/jwt.strategy';
import { MockEmailService } from './email/mock-email.service';
import { EmailService } from './email/email.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: ':memory:',
      entities: [User, UserEmail],
      synchronize: true,
      logging: false,
    }),
    TypeOrmModule.forFeature([User, UserEmail]),
    PassportModule,
    JwtModule.register({
      secret: 'test-secret-key',
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [UserController, UserProfileController, AuthController],
  providers: [
    UserService,
    AuthService,
    JwtStrategy,
    MockEmailService,
    {
      provide: EmailService,
      useClass: MockEmailService,
    },
  ],
})
export class TestAppModule {}