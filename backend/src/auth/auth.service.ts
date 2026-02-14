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

  async sendMagicLink(email: string): Promise<void> {
    // Find user by email
    const user = await this.userService.findUserByEmail(email);
    if (!user) {
      // Don't reveal if email exists or not for security
      return;
    }

    // Generate JWT token with 24-hour expiration
    const payload = { sub: user.id, email };
    const token = this.jwtService.sign(payload, { expiresIn: '24h' });

    // Create magic link
    const magicLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/verify?token=${token}`;

    // Send email
    await this.emailService.sendMagicLink(email, magicLink);
  }

  async verifyMagicLink(token: string): Promise<any> {
    try {
      const payload = this.jwtService.verify(token);
      return { userId: payload.sub, email: payload.email };
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