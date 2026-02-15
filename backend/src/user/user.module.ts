import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UserEmail } from './user-email.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';import { UserProfileController } from './user-profile.controller';
@Module({
  imports: [TypeOrmModule.forFeature([User, UserEmail])],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService, TypeOrmModule],
})
export class UserModule {}