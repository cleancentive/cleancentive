import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('magic-link')
  async sendMagicLink(@Body('email') email: string): Promise<{ success: boolean }> {
    await this.authService.sendMagicLink(email);
    return { success: true };
  }

  @Get('verify')
  async verifyMagicLink(@Query('token') token: string): Promise<any> {
    return this.authService.verifyMagicLink(token);
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