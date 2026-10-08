import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonalAccessToken } from './personal-access-token.entity';
import { PersonalAccessTokenService } from './personal-access-token.service';
import { PersonalAccessTokenController } from './personal-access-token.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PersonalAccessToken])],
  providers: [PersonalAccessTokenService],
  controllers: [PersonalAccessTokenController],
  exports: [PersonalAccessTokenService],
})
export class PersonalAccessTokenModule {}
