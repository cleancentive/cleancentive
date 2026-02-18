import { Controller, Get, Put, Post, Body, UseGuards, Request } from '@nestjs/common';
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
  @Post('email')
  async addEmail(
    @Request() req: any,
    @Body('email') email: string
  ): Promise<any> {
    return this.userService.registerUser(req.user.userId, email);
  }
}