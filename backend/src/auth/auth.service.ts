import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { randomInt } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { EmailService } from '../email/email.service';
import { UserService } from '../user/user.service';
import { toLocale } from '../user/notification-recipients';
import { AdminService } from '../admin/admin.service';
import { PendingAuthRequest, PendingAuthStatus } from './pending-auth-request.entity';
import { DeviceCode, DeviceCodeStatus } from './device-code.entity';
import { resolveFrontendUrl } from '../common/allowed-origins';
import { GUEST_SESSION_TTL, MAGIC_LINK_TTL } from './jwt-config';
import { isMagicLinkPayload, isSessionPayload, type TokenPayload } from './token-claims';
import type { RequestMetadata } from './request-metadata';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PendingSignInSummary {
  requestId: string;
  browser: string | null;
  location: string | null;
}

export interface VerifiedMagicLink {
  userId: string;
  email: string;
  requestId?: string;
  /** Set when a sign-in started on another device is still waiting on this link. */
  pendingSignIn: PendingSignInSummary | null;
}

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private emailService: EmailService,
    private userService: UserService,
    private adminService: AdminService,
    private eventEmitter: EventEmitter2,
    @InjectRepository(PendingAuthRequest)
    private pendingAuthRepo: Repository<PendingAuthRequest>,
    @InjectRepository(DeviceCode)
    private deviceCodeRepo: Repository<DeviceCode>,
  ) {}

  async sendMagicLink(
    email: string,
    guestId?: string,
    origin?: string,
    requestMetadata?: RequestMetadata,
  ): Promise<{ requestId: string } | null> {
    const existingUser = await this.userService.findUserByEmail(email);

    let userId: string;

    if (existingUser) {
      // Returning user. The guest id rides along in the token so the verify
      // step can merge that guest in, but only after the link is proven.
      userId = existingUser.id;
    } else if (guestId) {
      // A new address claiming a guest. The id is client-supplied: passing a
      // registered user's id here used to attach this address to their account
      // right away, and a magic link to it then let the sender in as them.
      // Nothing is written until the link comes back verified.
      if (!(await this.userService.isUnclaimedGuest(guestId))) {
        return null;
      }
      userId = guestId;
    } else {
      // No guest context and email not found — nothing to do
      return null;
    }

    const requestId = uuidv4();

    const payload: Record<string, string> = { sub: userId, email, requestId, purpose: 'magic-link' };
    if (guestId && existingUser && existingUser.id !== guestId) {
      payload.guestId = guestId;
    }
    const token = this.jwtService.sign(payload, { expiresIn: MAGIC_LINK_TTL });

    // The origin is attacker-controlled: a request carrying
    // `Origin: https://evil.example` used to have us mail a genuine-looking
    // link pointing at that host. Only allowlisted origins survive.
    const frontendUrl = resolveFrontendUrl(origin);
    const magicLink = `${frontendUrl}/auth/verify?token=${token}`;

    // Create pending auth request so the requesting browser can poll for completion
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.pendingAuthRepo.save({
      id: requestId,
      userId,
      sessionToken: null,
      status: PendingAuthStatus.PENDING,
      expiresAt,
      browser: requestMetadata?.browser ?? null,
      location: requestMetadata?.location ?? null,
    });

    await this.emailService.sendMagicLink(email, magicLink, requestMetadata);

    return { requestId };
  }

  async verifyMagicLink(token: string): Promise<VerifiedMagicLink> {
    let payload: TokenPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    // A session token is signed with the same secret. Without this it could
    // be replayed on the sign-in route, and so could an add-email or
    // merge-confirm token delivered to someone else's inbox.
    if (!isMagicLinkPayload(payload)) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    const email = payload.email as string;
    const guestId = payload.guestId as string | undefined;
    const requestId = payload.requestId as string | undefined;

    // The address is only attached now, once the link proves the person reading
    // that inbox asked for this. Between the request and the click someone else
    // may have registered it, in which case this is a sign-in to their account
    // and the claimed guest merges into it.
    const ownerOfEmail = await this.userService.findUserByEmail(email);
    const userId = ownerOfEmail?.id ?? (payload.sub as string);

    if (ownerOfEmail) {
      if (ownerOfEmail.id !== payload.sub && (await this.userService.isUnclaimedGuest(payload.sub as string))) {
        await this.userService.mergeGuestAccount(payload.sub as string, ownerOfEmail.id);
      }
    } else {
      if (!(await this.userService.isUnclaimedGuest(userId))) {
        // The token names an account that is not ours to claim and the address
        // is not on it. Nothing here is safe to attach.
        throw new UnauthorizedException('Invalid or expired magic link');
      }
      // Guest rows are created on first write, and this is it: the request step
      // no longer writes anything, so a guest claiming an account for the first
      // time has no row yet.
      await this.userService.findOrCreateGuest(userId);
      await this.userService.validateAndAssociateEmail(userId, email);
    }

    // A guest session that was active in the requesting browser folds into the
    // account being signed in to.
    if (guestId && guestId !== userId && (await this.userService.isUnclaimedGuest(guestId))) {
      await this.userService.mergeGuestAccount(guestId, userId);
    }

    await this.userService.updateLastLogin(userId);

    // Auto-promote to admin if email is in ADMIN_EMAILS. Safe here and not at
    // request time: the address has just been proven.
    if (this.adminService.isAdminEmail(email)) {
      await this.adminService.promoteToAdmin(userId, null);
    }

    this.eventEmitter.emit('user-email.changed', { userId });

    return { userId, email, requestId, pendingSignIn: await this.describePendingSignIn(requestId, userId) };
  }

  /**
   * The sign-in request this link belongs to, when it is still waiting and was
   * started by some other device.
   *
   * Completing it hands a session to whoever is polling, which is the whole
   * attack: request a link for someone else's address, keep the request id,
   * and collect their session the moment they click. The caller decides — the
   * same browser completes it silently, a different one asks first.
   */
  private async describePendingSignIn(
    requestId: string | undefined,
    userId: string,
  ): Promise<PendingSignInSummary | null> {
    if (!requestId) return null;

    const record = await this.pendingAuthRepo.findOne({ where: { id: requestId } });
    if (!record) return null;
    if (record.userId !== userId) return null;
    if (record.status !== PendingAuthStatus.PENDING) return null;
    if (record.expiresAt < new Date()) return null;

    return {
      requestId,
      browser: record.browser,
      location: record.location,
    };
  }

  /**
   * Hand the waiting device its session. Called by the browser that opened the
   * link, after it has established who it is — never by `verify` itself.
   */
  async completePendingAuthFor(requestId: string, userId: string): Promise<void> {
    const record = await this.pendingAuthRepo.findOne({ where: { id: requestId } });
    if (!record) {
      throw new NotFoundException('Pending auth request not found or expired');
    }
    if (record.userId !== userId) {
      throw new ForbiddenException('This sign-in request belongs to a different account');
    }
    if (record.expiresAt < new Date()) {
      await this.pendingAuthRepo.delete(requestId);
      throw new NotFoundException('Pending auth request not found or expired');
    }
    if (record.status === PendingAuthStatus.COMPLETED) return;

    const sessionToken = await this.generateSessionToken(userId);
    await this.pendingAuthRepo.update(requestId, {
      status: PendingAuthStatus.COMPLETED,
      sessionToken,
    });
  }

  /** Turn down a sign-in started elsewhere. The poller stops on the 404. */
  async rejectPendingAuth(requestId: string, userId: string): Promise<void> {
    const record = await this.pendingAuthRepo.findOne({ where: { id: requestId } });
    if (!record) return;
    if (record.userId !== userId) {
      throw new ForbiddenException('This sign-in request belongs to a different account');
    }
    await this.pendingAuthRepo.delete(requestId);
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

      this.eventEmitter.emit('user-email.changed', { userId: payload.sub });

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

    const frontendUrl = resolveFrontendUrl();
    const emails: string[] = [];
    const links: string[] = [];

    for (const userEmail of emailsToSend) {
      const payload = { sub: user.id, email: userEmail.email, purpose: 'magic-link' };
      const token = this.jwtService.sign(payload, { expiresIn: MAGIC_LINK_TTL });
      emails.push(userEmail.email);
      links.push(`${frontendUrl}/auth/verify?token=${token}`);
    }

    await this.emailService.sendRecoveryLinks(emails, links, toLocale(user.locale));
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

    // Rendered for the account being merged *into*, not the requester who triggered it.
    await this.emailService.sendMergeWarning(email, link, requester.nickname, toLocale(targetUser.locale));
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

      this.eventEmitter.emit('user-email.changed', { userId: targetUserId });

      return { mergedIntoUserId: targetUserId };
    } catch (error) {
      if (error.message === 'Invalid token purpose') throw error;
      throw new Error('Invalid or expired merge confirmation link');
    }
  }

  /**
   * Hand an anonymous visitor a session of their own.
   *
   * Guests used to be identified by a uuid the browser made up and sent as a
   * plain `guestId` parameter on every request. Since user ids are public —
   * they appear on spot pages and member lists — anyone could pass someone
   * else's id and read, edit or delete their picks. A guest now carries a
   * signed token like everybody else.
   *
   * An id already in localStorage is honoured once so existing guests keep
   * their picks; see UserService.claimGuestId.
   */
  async issueGuestToken(guestId?: string): Promise<{ token: string; userId: string }> {
    const isUuid = typeof guestId === 'string' && UUID_PATTERN.test(guestId);
    const userId = isUuid && (await this.userService.claimGuestId(guestId)) ? guestId : uuidv4();

    // No row is created here. It appears on the first write, as it always has,
    // so a visitor who only looks around leaves nothing behind.
    const token = this.jwtService.sign({ sub: userId, typ: 'guest' }, { expiresIn: GUEST_SESSION_TTL });
    return { token, userId };
  }

  async generateSessionToken(userId: string): Promise<string> {
    const payload = { sub: userId, typ: 'session' };
    return this.jwtService.sign(payload);
  }

  async validateSessionToken(token: string): Promise<any> {
    let payload: TokenPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch (error) {
      throw new UnauthorizedException('Invalid session token');
    }
    // An emailed link is signed with the same secret as a session, so the
    // signature alone does not say it may be used as one.
    if (!isSessionPayload(payload)) {
      throw new UnauthorizedException('Invalid session token');
    }
    return payload;
  }

  async refreshSessionToken(userId: string): Promise<string> {
    return this.generateSessionToken(userId);
  }

  async updateLastSeen(userId: string): Promise<void> {
    await this.userService.updateLastLogin(userId);
  }

  // ── Device code auth flow ──

  private static readonly DEVICE_CODE_EXPIRY_MINUTES = 5;

  async createDeviceCode(): Promise<{ id: string; deviceCode: string; expiresIn: number }> {
    // Clean up expired codes
    await this.deviceCodeRepo
      .createQueryBuilder()
      .delete()
      .where('"expiresAt" < :now', { now: new Date() })
      .execute();

    // Math.random is predictable: seeing a few codes narrows the generator
    // state, and these authorise a CLI session on the approving user's account.
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + AuthService.DEVICE_CODE_EXPIRY_MINUTES * 60 * 1000);

    const record = await this.deviceCodeRepo.save({
      code,
      sessionToken: null,
      status: DeviceCodeStatus.PENDING,
      expiresAt,
    });

    return {
      id: record.id,
      deviceCode: code,
      expiresIn: AuthService.DEVICE_CODE_EXPIRY_MINUTES * 60,
    };
  }

  async approveDeviceCode(code: string, adminUserId: string): Promise<void> {
    const record = await this.deviceCodeRepo.findOne({ where: { code } });

    if (!record || record.expiresAt < new Date() || record.status === DeviceCodeStatus.COMPLETED) {
      throw new NotFoundException('Device code not found or expired');
    }

    const sessionToken = await this.generateSessionToken(adminUserId);
    await this.deviceCodeRepo.update(record.id, {
      status: DeviceCodeStatus.COMPLETED,
      sessionToken,
    });
  }

  async rejectDeviceCode(code: string): Promise<void> {
    const record = await this.deviceCodeRepo.findOne({ where: { code } });

    if (!record || record.expiresAt < new Date() || record.status !== DeviceCodeStatus.PENDING) {
      throw new NotFoundException('Device code not found or expired');
    }

    await this.deviceCodeRepo.update(record.id, { status: DeviceCodeStatus.REJECTED });
  }

  async pollDeviceCode(id: string): Promise<{ status: string; sessionToken?: string }> {
    const record = await this.deviceCodeRepo.findOne({ where: { id } });

    if (!record || record.expiresAt < new Date()) {
      if (record) await this.deviceCodeRepo.delete(record.id);
      throw new NotFoundException('Device code not found or expired');
    }

    if (record.status === DeviceCodeStatus.COMPLETED) {
      await this.deviceCodeRepo.delete(record.id);
      return { status: 'completed', sessionToken: record.sessionToken };
    }

    if (record.status === DeviceCodeStatus.REJECTED) {
      await this.deviceCodeRepo.delete(record.id);
      return { status: 'rejected' };
    }

    return { status: 'pending' };
  }
}
