import { Controller, Get, Put, Delete, Body, UseGuards, Request, Param, Query, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserService } from './user.service';
import { User } from './user.entity';

@Controller('user')
export class UserProfileController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req: any): Promise<User> {
    return this.userService.findById(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async updateProfile(
    @Request() req: any,
    @Body() updates: { nickname?: string; full_name?: string }
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
    @Param('emailId') emailId: string,
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
}
