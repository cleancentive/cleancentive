import { Controller, Post, Body, Get, Query, Res, UseGuards, Request, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

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

  @UseGuards(JwtAuthGuard)
  @Post('add-email')
  async addEmail(
    @Request() req: any,
    @Body('email') email: string,
  ): Promise<{ status: string; ownerNickname?: string }> {
    return this.authService.sendEmailVerification(req.user.userId, email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('add-email/confirm-merge')
  async confirmMerge(
    @Request() req: any,
    @Body('email') email: string,
  ): Promise<{ success: boolean; sent: boolean }> {
    const result = await this.authService.sendMergeRequest(req.user.userId, email);
    return { success: true, sent: result.sent };
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Res() res: Response): Promise<void> {
    try {
      await this.authService.verifyEmailAddition(token);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}?emailAdded=true`);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}?emailError=${encodeURIComponent(error.message)}`);
    }
  }

  @Post('recover')
  async recover(
    @Body('email') email: string,
  ): Promise<{ success: boolean }> {
    await this.authService.sendRecoveryLinks(email);
    return { success: true };
  }

  @Get('merge-confirm')
  async mergeConfirm(@Query('token') token: string, @Res() res: Response): Promise<void> {
    try {
      await this.authService.verifyMergeConfirm(token);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}?merged=true`);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}?mergeError=${encodeURIComponent(error.message)}`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  async refreshToken(@Request() req: any): Promise<{ token: string }> {
    const token = await this.authService.refreshSessionToken(req.user.userId);
    return { token };
  }

  @Post('last-seen')
  async lastSeen(@Body('token') token: string, @Res() res: Response): Promise<void> {
    try {
      const payload = await this.authService.validateSessionToken(token);
      await this.authService.updateLastSeen(payload.sub);
      res.status(204).send();
    } catch {
      res.status(204).send(); // Silent fail — don't leak info
    }
  }

  @Post('logout')
  async logout(): Promise<{ success: boolean }> {
    // In a stateless JWT system, logout is handled client-side
    // This endpoint is for consistency and potential future server-side token blacklisting
    return { success: true };
  }
}