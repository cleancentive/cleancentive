import { Controller, Post, Get, Param, Body, Put } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './user.entity';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('guest')
  async createGuest(): Promise<User> {
    return this.userService.createGuestAccount();
  }

  @Get(':id')
  async getUser(@Param('id') id: string): Promise<User | null> {
    return this.userService.findById(id);
  }

  @Post(':id/register')
  async registerUser(
    @Param('id') userId: string,
    @Body('email') email: string,
  ): Promise<{ user: User; email: any; needsMerge: boolean }> {
    return this.userService.registerUser(userId, email);
  }

  @Post(':id/emails/select')
  async selectEmailsForLogin(
    @Param('id') userId: string,
    @Body('emailIds') emailIds: string[],
  ): Promise<any[]> {
    return this.userService.updateEmailSelection(userId, emailIds);
  }

  @Get(':id/emails/selected')
  async getSelectedEmails(@Param('id') userId: string): Promise<any[]> {
    return this.userService.getSelectedEmailsForLogin(userId);
  }

  @Put(':id/profile')
  async updateProfile(
    @Param('id') userId: string,
    @Body() updates: { nickname?: string; fullName?: string },
  ): Promise<User> {
    return this.userService.updateProfile(userId, updates);
  }
}