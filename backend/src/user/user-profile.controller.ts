import { Controller, Get, Put, Delete, Body, UseGuards, Request, Param, Query, BadRequestException, ParseUUIDPipe, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserService } from './user.service';
import { User } from './user.entity';

@Controller('user')
@ApiBearerAuth('Bearer')
@ApiTags('profile')
export class UserProfileController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req: any) {
    return this.userService.getProfileWithContext(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async updateProfile(
    @Request() req: any,
    @Body() updates: { nickname?: string; full_name?: string | null }
  ): Promise<User> {
    return this.userService.updateProfile(req.user.userId, {
      nickname: updates.nickname,
      fullName: updates.full_name,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('profile/email/:emailId')
  async removeEmail(
    @Request() req: any,
    @Param('emailId', ParseUUIDPipe) emailId: string,
  ): Promise<User> {
    return this.userService.removeEmail(req.user.userId, emailId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile/emails/selection')
  async updateEmailSelection(
    @Request() req: any,
    @Body('emailIds') emailIds: string[],
  ): Promise<any> {
    if (!emailIds || emailIds.length === 0) {
      throw new BadRequestException('At least one email must be selected for login');
    }
    return this.userService.updateEmailSelection(req.user.userId, emailIds);
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile/avatar')
  async updateAvatarEmail(
    @Request() req: any,
    @Body('emailId') emailId: string | null,
  ): Promise<User> {
    return this.userService.updateAvatarEmail(req.user.userId, emailId ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('profile')
  async deleteOrAnonymizeAccount(
    @Request() req: any,
    @Query('mode') mode: string,
  ): Promise<{ success: boolean }> {
    if (mode === 'delete') {
      await this.userService.deleteAccount(req.user.userId);
    } else if (mode === 'anonymize') {
      await this.userService.anonymizeAccount(req.user.userId);
    } else {
      throw new BadRequestException('mode must be "delete" or "anonymize"');
    }
    return { success: true };
  }

  @Delete('guest/:guestId')
  @HttpCode(200)
  async deleteGuestData(
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Query('mode') mode: string,
  ): Promise<{ success: boolean }> {
    if (mode === 'delete') {
      await this.userService.deleteAccount(guestId);
    } else if (mode === 'anonymize') {
      await this.userService.anonymizeAccount(guestId);
    } else {
      throw new BadRequestException('mode must be "delete" or "anonymize"');
    }
    return { success: true };
  }
}
