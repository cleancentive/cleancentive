import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from './admin.entity';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserEmail)
    private userEmailRepository: Repository<UserEmail>,
    private configService: ConfigService,
  ) {}

  async isAdmin(userId: string): Promise<boolean> {
    const admin = await this.adminRepository.findOne({ where: { user_id: userId } });
    return !!admin;
  }

  async promoteToAdmin(userId: string, promotedBy: string | null): Promise<Admin> {
    const existing = await this.adminRepository.findOne({ where: { user_id: userId } });
    if (existing) return existing;

    const admin = this.adminRepository.create({
      user_id: userId,
      created_by: promotedBy,
      updated_by: promotedBy,
    });
    return this.adminRepository.save(admin);
  }

  async demoteFromAdmin(userId: string): Promise<void> {
    await this.adminRepository.delete({ user_id: userId });
  }

  async getUsers(params: {
    page?: number;
    limit?: number;
    sort?: 'created_at' | 'last_login';
    order?: 'ASC' | 'DESC';
    search?: string;
  }): Promise<{ users: any[]; total: number }> {
    const page = params.page || 1;
    const limit = Math.min(params.limit || 10, 100);
    const sort = params.sort || 'created_at';
    const order = params.order || 'DESC';
    const search = params.search?.trim();

    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.emails', 'email')
      .leftJoin('admins', 'admin', 'admin.user_id = user.id')
      .addSelect('CASE WHEN admin.id IS NOT NULL THEN true ELSE false END', 'is_admin');

    if (search) {
      qb.where(
        '(user.nickname ILIKE :search OR user.full_name ILIKE :search OR email.email ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Get total count (need separate query due to grouping with search on emails)
    const totalQb = this.userRepository.createQueryBuilder('user');
    if (search) {
      totalQb.leftJoin('user.emails', 'email')
        .where(
          '(user.nickname ILIKE :search OR user.full_name ILIKE :search OR email.email ILIKE :search)',
          { search: `%${search}%` },
        );
    }
    const total = await totalQb.getCount();

    const rawUsers = await qb
      .orderBy(`user.${sort}`, order, sort === 'last_login' ? 'NULLS LAST' : undefined)
      .skip((page - 1) * limit)
      .take(limit)
      .getRawAndEntities();

    const users = rawUsers.entities.map((user, index) => ({
      ...user,
      is_admin: rawUsers.raw[index]?.is_admin === true || rawUsers.raw[index]?.is_admin === 'true',
    }));

    return { users, total };
  }

  async getUserDetail(userId: string): Promise<any> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['emails'],
    });
    if (!user) return null;

    const isAdmin = await this.isAdmin(userId);
    return { ...user, is_admin: isAdmin };
  }

  getAdminEmails(): string[] {
    const raw = this.configService.get<string>('ADMIN_EMAILS') || '';
    return raw.split(',').map(e => e.trim()).filter(Boolean);
  }

  isAdminEmail(email: string): boolean {
    return this.getAdminEmails().includes(email);
  }

  async ensureAdminEmailsPromoted(): Promise<void> {
    const adminEmails = this.getAdminEmails();
    if (adminEmails.length === 0) return;

    for (const email of adminEmails) {
      const userEmail = await this.userEmailRepository.findOne({
        where: { email },
        relations: ['user'],
      });

      if (userEmail?.user) {
        await this.promoteToAdmin(userEmail.user.id, null);
      }
    }
  }
}
