import { Controller, Post, Body, Delete, Get, Query, Param, ParseUUIDPipe, Res, UseGuards, Request, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { buildRequestMetadata, type RequestMetadata } from './request-metadata';

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('magic-link')
  async sendMagicLink(
    @Request() req,
    @Body('email') email: string,
    @Body('guestId') guestId?: string,
  ): Promise<{ success: boolean; requestId?: string }> {
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '');
    // Capture the requester's browser + approximate location + time so the
    // email can show them; lets the recipient distinguish their own sign-in
    // attempt from someone else's attempted impersonation. This is a
    // nice-to-have for the email body and must never block sign-in, so any
    // failure degrades to undefined (email falls back to "Unknown …").
    let requestMetadata: RequestMetadata | undefined;
    try {
      requestMetadata = buildRequestMetadata(req);
    } catch {
      requestMetadata = undefined;
    }
    const result = await this.authService.sendMagicLink(email, guestId, origin, requestMetadata);
    return { success: true, requestId: result?.requestId };
  }

  @Post('guest')
  @ApiOperation({ summary: 'Issue a guest session for an anonymous visitor' })
  async createGuestSession(
    @Body('guestId') guestId?: string,
  ): Promise<{ token: string; userId: string }> {
    return this.authService.issueGuestToken(guestId);
  }

  @Get('verify')
  async verifyMagicLink(@Query('token') token: string, @Res() res: Response): Promise<void> {
    const { userId, email, requestId, pendingSignIn } = await this.authService.verifyMagicLink(token);
    const sessionToken = await this.authService.generateSessionToken(userId);

    // Deliberately does not complete the pending request. Completing it here
    // handed a session to whoever started it, so requesting a link for someone
    // else's address and polling for the result was enough to take the account
    // over the moment they clicked. The browser that opened the link decides:
    // silently when it is the one that asked, after a prompt when it is not.
    res.setHeader('x-session-token', sessionToken);
    // requestId tells the magic-link tab which BroadcastChannel key to use so
    // only sibling tabs polling for *this* requestId apply the session.
    res.json({ userId, email, requestId, pendingSignIn });
  }

  @Get('pending/:requestId')
  async pollPendingAuth(@Param('requestId') requestId: string): Promise<{ status: string; sessionToken?: string }> {
    return this.authService.pollPendingAuth(requestId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('Bearer')
  @Post('pending/:requestId/complete')
  @ApiOperation({ summary: 'Hand a session to a sign-in started on another device' })
  async completePendingAuth(
    @Request() req: any,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<{ success: boolean }> {
    await this.authService.completePendingAuthFor(requestId, req.user.userId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('Bearer')
  @Delete('pending/:requestId')
  @ApiOperation({ summary: 'Turn down a sign-in started on another device' })
  async rejectPendingAuth(
    @Request() req: any,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<{ success: boolean }> {
    await this.authService.rejectPendingAuth(requestId, req.user.userId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('Bearer')
  @Post('add-email')
  async addEmail(
    @Request() req: any,
    @Body('email') email: string,
  ): Promise<{ status: string; ownerNickname?: string }> {
    return this.authService.sendEmailVerification(req.user.userId, email);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('Bearer')
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
  @ApiBearerAuth('Bearer')
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

  // ── Device code auth flow ──

  @Post('device-code')
  @ApiOperation({ summary: 'Generate a device code for CLI authentication' })
  async createDeviceCode(): Promise<{ id: string; deviceCode: string; expiresIn: number }> {
    return this.authService.createDeviceCode();
  }

  @Post('device-code/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Approve a device code — grants the CLI a session token for the approving user' })
  async approveDeviceCode(
    @Request() req: any,
    @Body('deviceCode') deviceCode: string,
  ): Promise<{ success: boolean }> {
    if (!deviceCode) {
      throw new BadRequestException('deviceCode is required');
    }
    try {
      await this.authService.approveDeviceCode(deviceCode, req.user.userId);
      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  @Post('device-code/reject')
  @ApiOperation({ summary: 'Reject a device code' })
  async rejectDeviceCode(
    @Body('deviceCode') deviceCode: string,
  ): Promise<{ success: boolean }> {
    if (!deviceCode) {
      throw new BadRequestException('deviceCode is required');
    }
    await this.authService.rejectDeviceCode(deviceCode);
    return { success: true };
  }

  @Get('device-code/:id')
  @ApiOperation({ summary: 'Poll device code status' })
  async pollDeviceCode(@Param('id') id: string): Promise<{ status: string; sessionToken?: string }> {
    return this.authService.pollDeviceCode(id);
  }
}
