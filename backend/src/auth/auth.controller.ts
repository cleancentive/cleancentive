import { Controller, Post, Body, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('magic-link')
  async sendMagicLink(
    @Body('email') email: string,
    @Body('guestId') guestId?: string,
  ): Promise<{ success: boolean }> {
    await this.authService.sendMagicLink(email, guestId);
    return { success: true };
  }

  @Get('verify')
  async verifyMagicLink(@Query('token') token: string, @Res() res: Response): Promise<void> {
    const { userId, email } = await this.authService.verifyMagicLink(token);
    const sessionToken = await this.authService.generateSessionToken(userId);

    res.setHeader('x-session-token', sessionToken);
    res.json({ userId, email });
  }

  @Post('refresh')
  async refreshToken(@Body('userId') userId: string): Promise<{ token: string }> {
    const token = await this.authService.refreshSessionToken(userId);
    return { token };
  }

  @Post('logout')
  async logout(): Promise<{ success: boolean }> {
    // In a stateless JWT system, logout is handled client-side
    // This endpoint is for consistency and potential future server-side token blacklisting
    return { success: true };
  }
}