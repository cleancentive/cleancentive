import { Controller, Get, Put, Delete, Body, UseGuards, Request, Param, Query, BadRequestException, PayloadTooLargeException, ParseUUIDPipe, HttpCode, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MulterExceptionFilter } from '../common/multer-exception.filter';
import { UserService } from './user.service';
import { User } from './user.entity';

const AVATAR_UPLOAD_MAX_BYTES = parseInt(process.env.AVATAR_UPLOAD_MAX_SIZE_BYTES || `${8 * 1024 * 1024}`, 10);

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
    @Body() updates: { nickname?: string; full_name?: string | null; locale?: string | null }
  ): Promise<User> {
    return this.userService.updateProfile(req.user.userId, {
      nickname: updates.nickname,
      fullName: updates.full_name,
      locale: updates.locale,
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
  @Put('profile/emails/calendar-selection')
  async updateCalendarEmailSelection(
    @Request() req: any,
    @Body('emailIds') emailIds: string[],
  ): Promise<any> {
    return this.userService.updateCalendarEmailSelection(req.user.userId, emailIds || []);
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
  @Put('profile/avatar-upload')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_UPLOAD_MAX_BYTES } }))
  async uploadAvatar(
    @Request() req: any,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<User> {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }
    if (file.size > AVATAR_UPLOAD_MAX_BYTES) {
      throw new PayloadTooLargeException(`Avatar exceeds max size of ${AVATAR_UPLOAD_MAX_BYTES} bytes`);
    }
    return this.userService.uploadAvatar(req.user.userId, file.buffer, file.mimetype);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('profile/avatar-upload')
  async removeUploadedAvatar(@Request() req: any): Promise<User> {
    return this.userService.removeUploadedAvatar(req.user.userId);
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
