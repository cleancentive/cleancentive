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

  async sendEmailVerification(userId: string, email: string): Promise<{ status: string; ownerNickname?: string }> {
    const existingUser = await this.userService.findUserByEmail(email);

    if (existingUser) {
      if (existingUser.id === userId) {
        return { status: 'already-yours' };
      }
      return { status: 'conflict', ownerNickname: existingUser.nickname };
    }

    const payload = { sub: userId, email, purpose: 'add-email' };
    const token = this.jwtService.sign(payload, { expiresIn: '24h' });
    const magicLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/verify-email?token=${token}`;
    await this.emailService.sendMagicLink(email, magicLink);
    return { status: 'verification-sent' };
  }

  async verifyEmailAddition(token: string): Promise<{ userId: string; email: string }> {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.purpose !== 'add-email') {
        throw new Error('Invalid token purpose');
      }
      await this.userService.validateAndAssociateEmail(payload.sub, payload.email);
      return { userId: payload.sub, email: payload.email };
    } catch (error) {
      if (error.message === 'Invalid token purpose') throw error;
      throw new Error('Invalid or expired verification link');
    }
  }

  async sendRecoveryLinks(email: string): Promise<void> {
    const user = await this.userService.findUserByEmail(email);
    if (!user) return; // Silent — don't reveal whether email exists

    const allEmails = await this.userService.getSelectedEmailsForLogin(user.id);
    // If no emails are selected, fall back to all emails
    const emailsToSend = allEmails.length > 0
      ? allEmails
      : (await this.userService.findById(user.id))?.emails || [];

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const emails: string[] = [];
    const links: string[] = [];

    for (const userEmail of emailsToSend) {
      const payload = { sub: user.id, email: userEmail.email };
      const token = this.jwtService.sign(payload, { expiresIn: '24h' });
      emails.push(userEmail.email);
      links.push(`${frontendUrl}/auth/verify?token=${token}`);
    }

    await this.emailService.sendRecoveryLinks(emails, links);
  }

  async sendMergeRequest(requesterId: string, email: string): Promise<{ sent: boolean }> {
    const targetUser = await this.userService.findUserByEmail(email);
    if (!targetUser || targetUser.id === requesterId) {
      return { sent: false };
    }

    const requester = await this.userService.findById(requesterId);
    if (!requester) return { sent: false };

    const payload = {
      sub: targetUser.id,
      email,
      purpose: 'merge-confirm',
      mergeIntoUserId: requesterId,
    };
    const token = this.jwtService.sign(payload, { expiresIn: '24h' });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/auth/merge-confirm?token=${token}`;

    await this.emailService.sendMergeWarning(email, link, requester.nickname);
    return { sent: true };
  }

  async verifyMergeConfirm(token: string): Promise<{ mergedIntoUserId: string }> {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.purpose !== 'merge-confirm') {
        throw new Error('Invalid token purpose');
      }

      const sourceUserId = payload.sub; // Account B being merged/deleted
      const targetUserId = payload.mergeIntoUserId; // Account A receiving data

      // Transfer data from source to target, then delete source
      await this.userService.mergeAccounts(sourceUserId, targetUserId);

      return { mergedIntoUserId: targetUserId };
    } catch (error) {
      if (error.message === 'Invalid token purpose') throw error;
      throw new Error('Invalid or expired merge confirmation link');
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