import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UserEmail } from './user-email.entity';

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

    // Create new email association
    const userEmail = this.userEmailRepository.create({
      email,
      user_id: userId,
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
      throw new BadRequestException('User not found');
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

    await this.userRepository.remove(guestUser);

    return this.findById(existingUserId);
  }


  async updateProfile(userId: string, updates: { nickname?: string; fullName?: string }): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
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

    // Set updated_by to the current user
    user.updated_by = userId;

    return this.userRepository.save(user);
  }
}
