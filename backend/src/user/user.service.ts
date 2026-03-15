import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { User } from './user.entity';
import { UserEmail } from './user-email.entity';

const AVATAR_CACHE_DIR = join(process.env.AVATAR_CACHE_DIR || '/tmp', 'avatar-cache');
const AVATAR_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserEmail)
    private userEmailRepository: Repository<UserEmail>,
  ) {}

  async createGuestAccount(): Promise<User> {
    const guestUser = this.userRepository.create({
      nickname: 'guest',
    });
    return this.userRepository.save(guestUser);
  }

  async findOrCreateGuest(guestId: string): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { id: guestId },
      relations: ['emails'],
    });
    if (existing) return existing;

    const guest = this.userRepository.create({
      id: guestId,
      nickname: 'guest',
    });
    return this.userRepository.save(guest);
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: ['emails'],
    });
  }

  async findByNickname(nickname: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { nickname },
      relations: ['emails'],
    });
  }

  private async transferCleanupOwnership(sourceUserId: string, targetUserId: string): Promise<void> {
    await this.userRepository.query(
      `
        UPDATE users AS target
        SET active_team_id = COALESCE(target.active_team_id, source.active_team_id),
            active_cleanup_date_id = COALESCE(target.active_cleanup_date_id, source.active_cleanup_date_id),
            updated_at = NOW()
        FROM users AS source
        WHERE target.id = $1
          AND source.id = $2
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE spots
        SET user_id = $1,
            updated_by = $1,
            updated_at = NOW()
        WHERE user_id = $2
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE spots
        SET created_by = $1
        WHERE created_by = $2
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE spots
        SET updated_by = $1
        WHERE updated_by = $2
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE detected_items
        SET created_by = $1
        WHERE created_by = $2
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE detected_items
        SET updated_by = $1
        WHERE updated_by = $2
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE team_memberships source
        SET user_id = $1,
            updated_by = $1,
            updated_at = NOW()
        WHERE source.user_id = $2
          AND NOT EXISTS (
            SELECT 1
            FROM team_memberships target
            WHERE target.team_id = source.team_id
              AND target.user_id = $1
          )
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE team_memberships
        SET role = 'admin',
            updated_by = $1,
            updated_at = NOW()
        WHERE user_id = $1
          AND team_id IN (
            SELECT team_id
            FROM team_memberships
            WHERE user_id = $2
              AND role = 'admin'
          )
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        DELETE FROM team_memberships
        WHERE user_id = $1
      `,
      [sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE cleanup_participants source
        SET user_id = $1,
            updated_by = $1,
            updated_at = NOW()
        WHERE source.user_id = $2
          AND NOT EXISTS (
            SELECT 1
            FROM cleanup_participants target
            WHERE target.cleanup_id = source.cleanup_id
              AND target.user_id = $1
          )
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE cleanup_participants
        SET role = 'admin',
            updated_by = $1,
            updated_at = NOW()
        WHERE user_id = $1
          AND cleanup_id IN (
            SELECT cleanup_id
            FROM cleanup_participants
            WHERE user_id = $2
              AND role = 'admin'
          )
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        DELETE FROM cleanup_participants
        WHERE user_id = $1
      `,
      [sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE team_messages
        SET author_user_id = $1,
            updated_by = $1,
            updated_at = NOW()
        WHERE author_user_id = $2
      `,
      [targetUserId, sourceUserId],
    );

    await this.userRepository.query(
      `
        UPDATE cleanup_messages
        SET author_user_id = $1,
            updated_by = $1,
            updated_at = NOW()
        WHERE author_user_id = $2
      `,
      [targetUserId, sourceUserId],
    );
  }

  private validateEmailFormat(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const userEmail = await this.userEmailRepository.findOne({
      where: { email },
      relations: ['user'],
    });
    return userEmail?.user || null;
  }

  async validateAndAssociateEmail(userId: string, email: string): Promise<UserEmail> {
    if (!this.validateEmailFormat(email)) {
      throw new BadRequestException('Invalid email format');
    }

    // Check if email already exists
    const existingEmail = await this.userEmailRepository.findOne({
      where: { email },
      relations: ['user'],
    });

    if (existingEmail) {
      if (existingEmail.user_id === userId) {
        // Email already associated with this user
        return existingEmail;
      } else {
        // Email belongs to another user - this will be handled in registration logic
        throw new BadRequestException('Email already associated with another account');
      }
    }

    // Check if this is the first email for the user (claiming guest account)
    const existingEmails = await this.userEmailRepository.count({ where: { user_id: userId } });

    const userEmail = this.userEmailRepository.create({
      email,
      user_id: userId,
      is_selected_for_login: existingEmails === 0,
    });

    return this.userEmailRepository.save(userEmail);
  }

  async registerUser(userId: string, email: string): Promise<{ user: User; email: UserEmail; needsMerge: boolean }> {
    // Check if email already exists with another user
    const existingUser = await this.findUserByEmail(email);
    
    if (existingUser && existingUser.id !== userId) {
      // Email belongs to another user - mark for merging
      const userEmail = await this.validateAndAssociateEmail(userId, email);
      return { user: existingUser, email: userEmail, needsMerge: true };
    }

    // Normal registration - associate email with current user
    const userEmail = await this.validateAndAssociateEmail(userId, email);
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { user, email: userEmail, needsMerge: false };
  }

  async updateEmailSelection(userId: string, emailIds: string[]): Promise<UserEmail[]> {
    // First, deselect all emails for this user
    await this.userEmailRepository.update(
      { user_id: userId },
      { is_selected_for_login: false }
    );

    // Then select the specified emails
    if (emailIds.length > 0) {
      await this.userEmailRepository.update(
        { id: emailIds[0] },
        { is_selected_for_login: true }
      );
      
      for (let i = 1; i < emailIds.length; i++) {
        await this.userEmailRepository.update(
          { id: emailIds[i] },
          { is_selected_for_login: true }
        );
      }
    }

    // Return updated emails
    return this.userEmailRepository.find({
      where: { user_id: userId },
    });
  }

  async getSelectedEmailsForLogin(userId: string): Promise<UserEmail[]> {
    return this.userEmailRepository.find({
      where: { 
        user_id: userId,
        is_selected_for_login: true 
      },
    });
  }

  async mergeGuestAccount(guestUserId: string, existingUserId: string): Promise<User> {
    if (guestUserId === existingUserId) {
      return this.findById(existingUserId);
    }

    const guestUser = await this.findById(guestUserId);
    if (!guestUser || guestUser.nickname !== 'guest') {
      return this.findById(existingUserId);
    }

    // Transfer emails from guest to existing user (if any)
    await this.userEmailRepository.update(
      { user_id: guestUserId },
      { user_id: existingUserId },
    );

    await this.transferCleanupOwnership(guestUserId, existingUserId);

    await this.userRepository.remove(guestUser);

    return this.findById(existingUserId);
  }


  async mergeAccounts(sourceUserId: string, targetUserId: string): Promise<User> {
    if (sourceUserId === targetUserId) {
      return this.findById(targetUserId);
    }

    const sourceUser = await this.findById(sourceUserId);
    if (!sourceUser) {
      return this.findById(targetUserId);
    }

    // Transfer emails from source to target
    await this.userEmailRepository.update(
      { user_id: sourceUserId },
      { user_id: targetUserId },
    );

    await this.transferCleanupOwnership(sourceUserId, targetUserId);

    await this.userRepository.remove(sourceUser);

    return this.findById(targetUserId);
  }

  async removeEmail(userId: string, emailId: string): Promise<User> {
    const emails = await this.userEmailRepository.find({ where: { user_id: userId } });
    if (emails.length <= 1) {
      throw new BadRequestException('Cannot remove last email. Use account deletion or anonymization instead.');
    }

    const emailToRemove = emails.find(e => e.id === emailId);
    if (!emailToRemove) {
      throw new NotFoundException('Email not found');
    }

    await this.userEmailRepository.remove(emailToRemove);

    // If removed email was selected for login and no others are, select the first remaining
    if (emailToRemove.is_selected_for_login) {
      const remaining = await this.userEmailRepository.find({ where: { user_id: userId, is_selected_for_login: true } });
      if (remaining.length === 0) {
        const first = await this.userEmailRepository.findOne({ where: { user_id: userId } });
        if (first) {
          first.is_selected_for_login = true;
          await this.userEmailRepository.save(first);
        }
      }
    }

    return this.findById(userId);
  }

  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.userRepository.remove(user);
  }

  async anonymizeAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Delete all emails
    await this.userEmailRepository.delete({ user_id: userId });

    // Reset to guest state
    user.nickname = 'guest';
    user.full_name = null;
    user.avatar_email_id = null;
    user.active_team_id = null;
    user.active_cleanup_date_id = null;
    await this.userRepository.save(user);
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.userRepository.update({ id: userId }, { last_login: new Date() });
  }

  async updateProfile(userId: string, updates: { nickname?: string; fullName?: string }): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (updates.nickname) {
      if (updates.nickname !== 'guest') {
        const existingUser = await this.findByNickname(updates.nickname);
        if (existingUser && existingUser.id !== userId) {
          throw new BadRequestException('Nickname already taken');
        }
      }
      user.nickname = updates.nickname;
    }

    if (updates.fullName !== undefined) {
      user.full_name = updates.fullName;
    }

    return this.userRepository.save(user);
  }

  async updateAvatarEmail(userId: string, emailId: string | null): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (emailId !== null) {
      const email = await this.userEmailRepository.findOne({
        where: { id: emailId, user_id: userId },
      });
      if (!email) {
        throw new BadRequestException('Email not found on your account');
      }
    }

    user.avatar_email_id = emailId;
    return this.userRepository.save(user);
  }

  async getAvatarImage(userId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const user = await this.findById(userId);
    if (!user || !user.avatar_email_id) {
      return null;
    }

    const email = user.emails?.find(e => e.id === user.avatar_email_id);
    if (!email) {
      return null;
    }

    const hash = createHash('md5').update(email.email.trim().toLowerCase()).digest('hex');
    const cachePath = join(AVATAR_CACHE_DIR, `${hash}.jpg`);

    // Check cache
    try {
      const fileStat = await stat(cachePath);
      if (Date.now() - fileStat.mtimeMs < AVATAR_CACHE_TTL_MS) {
        const buffer = await readFile(cachePath);
        return { buffer, contentType: 'image/jpeg' };
      }
    } catch {
      // Cache miss — continue to fetch
    }

    // Fetch from Gravatar
    try {
      const response = await fetch(
        `https://www.gravatar.com/avatar/${hash}?s=200&d=404`,
      );
      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      // Cache to disk
      try {
        await mkdir(AVATAR_CACHE_DIR, { recursive: true });
        await writeFile(cachePath, buffer);
      } catch {
        // Cache write failure is non-fatal
      }

      return { buffer, contentType };
    } catch {
      return null;
    }
  }
}
