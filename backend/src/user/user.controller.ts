import { Controller, Post, Get, Param, Body, Put, Res, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './user.entity';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('guest')
  async createGuest(): Promise<User> {
    return this.userService.createGuestAccount();
  }

  @Get(':id/avatar')
  async getAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: any,
  ): Promise<void> {
    const result = await this.userService.getAvatarImage(id);
    if (!result) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(result.buffer);
  }

  @Get(':id')
  async getUser(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    const user = await this.userService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @Post(':id/register')
  async registerUser(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body('email') email: string,
  ): Promise<{ user: User; email: any; needsMerge: boolean }> {
    return this.userService.registerUser(userId, email);
  }

  @Post(':id/emails/select')
  async selectEmailsForLogin(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body('emailIds') emailIds: string[],
  ): Promise<any[]> {
    return this.userService.updateEmailSelection(userId, emailIds);
  }

  @Get(':id/emails/selected')
  async getSelectedEmails(@Param('id', ParseUUIDPipe) userId: string): Promise<any[]> {
    return this.userService.getSelectedEmailsForLogin(userId);
  }

  @Put(':id/profile')
  async updateProfile(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() updates: { nickname?: string; fullName?: string },
  ): Promise<User> {
    return this.userService.updateProfile(userId, updates);
  }
}