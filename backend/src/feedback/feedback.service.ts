import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Feedback } from './feedback.entity';
import { FeedbackResponse } from './feedback-response.entity';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { EmailService } from '../email/email.service';
import { AdminService } from '../admin/admin.service';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectRepository(Feedback)
    private readonly feedbackRepository: Repository<Feedback>,
    @InjectRepository(FeedbackResponse)
    private readonly responseRepository: Repository<FeedbackResponse>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserEmail)
    private readonly userEmailRepository: Repository<UserEmail>,
    private readonly emailService: EmailService,
    private readonly adminService: AdminService,
    private readonly configService: ConfigService,
  ) {}

  async create(input: {
    category: 'bug' | 'suggestion' | 'question';
    description: string;
    contactEmail?: string;
    userId?: string;
    guestId?: string;
    errorContext?: { url?: string; message?: string; userAgent?: string; stack?: string };
  }): Promise<Feedback> {
    const feedback = this.feedbackRepository.create({
      category: input.category,
      description: input.description.slice(0, 2000),
      contact_email: input.contactEmail || null,
      user_id: input.userId || null,
      guest_id: input.guestId || null,
      error_context: input.errorContext || null,
    });
    const saved = await this.feedbackRepository.save(feedback);

    await this.notifyStewards(saved);
    return saved;
  }

  async addResponse(feedbackId: string, message: string, isFromSteward: boolean, actorUserId?: string): Promise<FeedbackResponse> {
    const feedback = await this.feedbackRepository.findOne({ where: { id: feedbackId } });
    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    const response = this.responseRepository.create({
      feedback_id: feedbackId,
      message: message.slice(0, 2000),
      is_from_steward: isFromSteward,
    });
    const saved = await this.responseRepository.save(response);

    if (isFromSteward && feedback.contact_email) {
      await this.notifyUser(feedback, message);
    } else if (!isFromSteward) {
      await this.notifyStewards(feedback, message);
    }

    return saved;
  }

  async findAll(filters: { status?: string; category?: string; page?: number }): Promise<{ items: Feedback[]; total: number }> {
    const page = filters.page || 1;
    const take = 20;
    const skip = (page - 1) * take;

    const qb = this.feedbackRepository.createQueryBuilder('f')
      .leftJoinAndSelect('f.responses', 'r')
      .orderBy('f.created_at', 'DESC');

    if (filters.status) {
      qb.andWhere('f.status = :status', { status: filters.status });
    }
    if (filters.category) {
      qb.andWhere('f.category = :category', { category: filters.category });
    }

    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();

    // Resolve user nicknames
    const userIds = items.map((f) => f.user_id).filter(Boolean) as string[];
    if (userIds.length > 0) {
      const users = await this.userRepository.find({ where: { id: In(userIds) }, select: ['id', 'nickname'] });
      const userMap = new Map(users.map((u) => [u.id, u.nickname]));
      for (const item of items) {
        (item as any).submitter_nickname = item.user_id ? userMap.get(item.user_id) || null : null;
      }
    }

    // Resolve steward nicknames on responses
    const stewardResponseUserIds = items
      .flatMap((f) => f.responses || [])
      .filter((r) => r.is_from_steward && r.created_by)
      .map((r) => r.created_by);
    if (stewardResponseUserIds.length > 0) {
      const stewards = await this.userRepository.find({ where: { id: In(stewardResponseUserIds) }, select: ['id', 'nickname'] });
      const stewardMap = new Map(stewards.map((u) => [u.id, u.nickname]));
      for (const item of items) {
        for (const r of item.responses || []) {
          (r as any).author_nickname = r.created_by ? stewardMap.get(r.created_by) || null : null;
        }
      }
    }

    return { items, total };
  }

  async findByUser(userId: string): Promise<Feedback[]> {
    return this.feedbackRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      relations: ['responses'],
    });
  }

  async findByGuest(guestId: string): Promise<Feedback[]> {
    return this.feedbackRepository.find({
      where: { guest_id: guestId },
      order: { created_at: 'DESC' },
      relations: ['responses'],
    });
  }

  async findOne(id: string): Promise<Feedback> {
    const feedback = await this.feedbackRepository.findOne({
      where: { id },
      relations: ['responses'],
    });
    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    // Resolve steward nicknames on responses
    const stewardResponseUserIds = (feedback.responses || [])
      .filter((r) => r.is_from_steward && r.created_by)
      .map((r) => r.created_by);
    if (stewardResponseUserIds.length > 0) {
      const stewards = await this.userRepository.find({ where: { id: In(stewardResponseUserIds) }, select: ['id', 'nickname'] });
      const stewardMap = new Map(stewards.map((u) => [u.id, u.nickname]));
      for (const r of feedback.responses) {
        (r as any).author_nickname = r.created_by ? stewardMap.get(r.created_by) || null : null;
      }
    }

    // Resolve submitter nickname
    if (feedback.user_id) {
      const user = await this.userRepository.findOne({ where: { id: feedback.user_id }, select: ['id', 'nickname'] });
      (feedback as any).submitter_nickname = user?.nickname || null;
    }

    return feedback;
  }

  async updateStatus(id: string, status: 'new' | 'acknowledged' | 'in_progress' | 'resolved'): Promise<Feedback> {
    const feedback = await this.feedbackRepository.findOne({ where: { id } });
    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    feedback.status = status;
    const saved = await this.feedbackRepository.save(feedback);

    if (feedback.contact_email) {
      await this.notifyUser(feedback, `Your feedback status has been updated to: ${status.replace('_', ' ')}`);
    }

    return saved;
  }

  assertOwnership(feedback: Feedback, userId?: string, guestId?: string): void {
    if (userId && feedback.user_id === userId) return;
    if (guestId && feedback.guest_id === guestId) return;
    throw new ForbiddenException('You do not have access to this feedback');
  }

  private async notifyStewards(feedback: Feedback, followUpMessage?: string): Promise<void> {
    const notifyEmail = this.configService.get<string>('FEEDBACK_NOTIFY_EMAIL');
    if (!notifyEmail) return;

    const subject = followUpMessage
      ? `[Feedback] Follow-up on ${feedback.category}: ${feedback.description.slice(0, 50)}...`
      : `[Feedback] New ${feedback.category}: ${feedback.description.slice(0, 50)}...`;

    const body = followUpMessage || feedback.description;

    try {
      await this.emailService.sendCommunityMessage([notifyEmail], null, {
        subject,
        preheader: 'New feedback on CleanCentive',
        title: `Feedback: ${feedback.category}`,
        body,
        disclosure: 'This is an automated notification from CleanCentive.',
      });
    } catch (err) {
      this.logger.warn(`Failed to send feedback notification: ${err}`);
    }
  }

  private async notifyUser(feedback: Feedback, message: string): Promise<void> {
    if (!feedback.contact_email) return;

    try {
      await this.emailService.sendCommunityMessage([feedback.contact_email], null, {
        subject: `[CleanCentive] Update on your feedback`,
        preheader: 'A steward responded to your feedback',
        title: 'Feedback Update',
        body: message,
        disclosure: 'You received this because you provided your email when submitting feedback on CleanCentive.',
      });
    } catch (err) {
      this.logger.warn(`Failed to send user feedback notification: ${err}`);
    }
  }
}
