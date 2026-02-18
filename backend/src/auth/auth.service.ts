import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private emailService: EmailService,
    private userService: UserService,
  ) {}

  async sendMagicLink(email: string, guestId?: string): Promise<void> {
    const existingUser = await this.userService.findUserByEmail(email);

    let userId: string;

    if (existingUser) {
      // Returning user — send magic link to existing account
      // Include guestId in token so verify step can merge the guest into this account
      userId = existingUser.id;
    } else if (guestId) {
      // New claim — attach email to guest account, then send magic link
      const guestUser = await this.userService.findById(guestId);
      if (!guestUser) {
        return;
      }
      await this.userService.validateAndAssociateEmail(guestId, email);
      userId = guestId;
    } else {
      // No guest context and email not found — nothing to do
      return;
    }

    const payload: Record<string, string> = { sub: userId, email };
    if (guestId && existingUser && existingUser.id !== guestId) {
      payload.guestId = guestId;
    }
    const token = this.jwtService.sign(payload, { expiresIn: '24h' });

    const magicLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/verify?token=${token}`;

    await this.emailService.sendMagicLink(email, magicLink);
  }

  async verifyMagicLink(token: string): Promise<{ userId: string; email: string }> {
    try {
      const payload = this.jwtService.verify(token);
      const userId = payload.sub;
      const guestId = payload.guestId;

      // If a guest session was active when the magic link was requested,
      // merge the guest account into the existing user
      if (guestId && guestId !== userId) {
        await this.userService.mergeGuestAccount(guestId, userId);
      }

      return { userId, email: payload.email };
    } catch (error) {
      throw new Error('Invalid or expired magic link');
    }
  }

  async generateSessionToken(userId: string): Promise<string> {
    const payload = { sub: userId };
    return this.jwtService.sign(payload);
  }

  async validateSessionToken(token: string): Promise<any> {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      throw new Error('Invalid session token');
    }
  }

  async refreshSessionToken(userId: string): Promise<string> {
    // For now, just generate a new token
    // In a more complex system, you might check token expiration
    return this.generateSessionToken(userId);
  }
}