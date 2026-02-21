import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { EmailService } from '../email/email.service';
import { UserService } from '../user/user.service';
import { AdminService } from '../admin/admin.service';
import { PendingAuthRequest, PendingAuthStatus } from './pending-auth-request.entity';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private emailService: EmailService,
    private userService: UserService,
    private adminService: AdminService,
    @InjectRepository(PendingAuthRequest)
    private pendingAuthRepo: Repository<PendingAuthRequest>,
  ) {}

  async sendMagicLink(email: string, guestId?: string): Promise<{ requestId: string } | null> {
    const existingUser = await this.userService.findUserByEmail(email);

    let userId: string;

    if (existingUser) {
      // Returning user — send magic link to existing account
      // Include guestId in token so verify step can merge the guest into this account
      userId = existingUser.id;
    } else if (guestId) {
      // New claim — create guest if needed, attach email, then send magic link
      await this.userService.findOrCreateGuest(guestId);
      await this.userService.validateAndAssociateEmail(guestId, email);
      userId = guestId;
    } else {
      // No guest context and email not found — nothing to do
      return null;
    }

    const requestId = uuidv4();

    const payload: Record<string, string> = { sub: userId, email, requestId };
    if (guestId && existingUser && existingUser.id !== guestId) {
      payload.guestId = guestId;
    }
    const token = this.jwtService.sign(payload, { expiresIn: '24h' });

    const magicLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/verify?token=${token}`;

    // Create pending auth request so the requesting browser can poll for completion
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.pendingAuthRepo.save({
      id: requestId,
      userId,
      sessionToken: null,
      status: PendingAuthStatus.PENDING,
      expiresAt,
    });

    await this.emailService.sendMagicLink(email, magicLink);

    return { requestId };
  }

  async verifyMagicLink(token: string): Promise<{ userId: string; email: string; requestId?: string }> {
    try {
      const payload = this.jwtService.verify(token);
      const userId = payload.sub;
      const guestId = payload.guestId;
      const requestId = payload.requestId as string | undefined;

      // If a guest session was active when the magic link was requested,
      // merge the guest account into the existing user
      if (guestId && guestId !== userId) {
        await this.userService.mergeGuestAccount(guestId, userId);
      }

      await this.userService.updateLastLogin(userId);

      // Auto-promote to admin if email is in ADMIN_EMAILS
      if (this.adminService.isAdminEmail(payload.email)) {
        await this.adminService.promoteToAdmin(userId, null);
      }

      return { userId, email: payload.email, requestId };
    } catch (error) {
      throw new Error('Invalid or expired magic link');
    }
  }

  async completePendingAuth(requestId: string, sessionToken: string): Promise<void> {
    const record = await this.pendingAuthRepo.findOne({ where: { id: requestId } });
    if (!record || record.status === PendingAuthStatus.COMPLETED) return;
    await this.pendingAuthRepo.update(requestId, {
      status: PendingAuthStatus.COMPLETED,
      sessionToken,
    });
  }

  async pollPendingAuth(requestId: string): Promise<{ status: string; sessionToken?: string }> {
    const record = await this.pendingAuthRepo.findOne({ where: { id: requestId } });

    if (!record || record.expiresAt < new Date()) {
      if (record) await this.pendingAuthRepo.delete(requestId);
      throw new NotFoundException('Pending auth request not found or expired');
    }

    if (record.status === PendingAuthStatus.COMPLETED) {
      await this.pendingAuthRepo.delete(requestId);
      return { status: 'completed', sessionToken: record.sessionToken };
    }

    return { status: 'pending' };
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
    const apiBase = `${process.env.API_URL || 'http://localhost:3000'}${process.env.API_PREFIX || '/api/v1'}`;
    const magicLink = `${apiBase}/auth/verify-email?token=${token}`;
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

      // Auto-promote to admin if newly added email is in ADMIN_EMAILS
      if (this.adminService.isAdminEmail(payload.email)) {
        await this.adminService.promoteToAdmin(payload.sub, null);
      }

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
    const apiBase = `${process.env.API_URL || 'http://localhost:3000'}${process.env.API_PREFIX || '/api/v1'}`;
    const link = `${apiBase}/auth/merge-confirm?token=${token}`;

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
    return this.generateSessionToken(userId);
  }

  async updateLastSeen(userId: string): Promise<void> {
    await this.userService.updateLastLogin(userId);
  }
}
