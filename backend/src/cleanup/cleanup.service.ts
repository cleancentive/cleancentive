import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Cleanup } from './cleanup.entity';
import { CleanupDate } from './cleanup-date.entity';
import { CleanupParticipant } from './cleanup-participant.entity';
import { CleanupMessage } from './cleanup-message.entity';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { AdminService } from '../admin/admin.service';
import { EmailService } from '../email/email.service';

interface CreateCleanupInput {
  name: string;
  description: string;
  date: {
    startAt: Date;
    endAt: Date;
    latitude: number;
    longitude: number;
    locationName?: string;
  };
}

interface SearchCleanupsInput {
  query?: string;
  status?: 'past' | 'ongoing' | 'future';
  date?: Date;
  includeArchived?: boolean;
  memberOnly?: boolean;
  currentUserIsPlatformAdmin: boolean;
  userId?: string;
}

interface CreateCleanupMessageInput {
  cleanupId: string;
  authorUserId: string;
  audience: 'members' | 'organizers';
  subject: string;
  body: string;
}

interface SimilarCleanupsInput {
  name: string;
  startAt?: Date;
  latitude?: number;
  longitude?: number;
}

interface ActiveCleanupDateResolution {
  cleanupId: string | null;
  cleanupDateId: string | null;
  warning: string | null;
}

@Injectable()
export class CleanupService {
  private readonly warningThresholdKm = 15;

  constructor(
    @InjectRepository(Cleanup)
    private readonly cleanupRepository: Repository<Cleanup>,
    @InjectRepository(CleanupDate)
    private readonly cleanupDateRepository: Repository<CleanupDate>,
    @InjectRepository(CleanupParticipant)
    private readonly cleanupParticipantRepository: Repository<CleanupParticipant>,
    @InjectRepository(CleanupMessage)
    private readonly cleanupMessageRepository: Repository<CleanupMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserEmail)
    private readonly userEmailRepository: Repository<UserEmail>,
    private readonly adminService: AdminService,
    private readonly emailService: EmailService,
  ) {}

  normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private async getCleanupOrThrow(cleanupId: string): Promise<Cleanup> {
    const cleanup = await this.cleanupRepository.findOne({ where: { id: cleanupId } });
    if (!cleanup) {
      throw new NotFoundException('Cleanup not found');
    }
    return cleanup;
  }

  private async ensureCleanupNotArchived(cleanup: Cleanup): Promise<void> {
    if (cleanup.archived_at) {
      throw new BadRequestException('Cleanup is archived');
    }
  }

  private async getParticipant(cleanupId: string, userId: string): Promise<CleanupParticipant | null> {
    return this.cleanupParticipantRepository.findOne({ where: { cleanup_id: cleanupId, user_id: userId } });
  }

  private async getParticipantOrThrow(cleanupId: string, userId: string): Promise<CleanupParticipant> {
    const participant = await this.getParticipant(cleanupId, userId);
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this cleanup');
    }
    return participant;
  }

  private async ensureOrganizer(cleanupId: string, userId: string): Promise<CleanupParticipant> {
    const participant = await this.getParticipantOrThrow(cleanupId, userId);
    if (participant.role !== 'organizer') {
      throw new ForbiddenException('Cleanup organizer permissions required');
    }
    return participant;
  }

  private async ensureRegisteredUser(userId: string): Promise<void> {
    const emailCount = await this.userEmailRepository.count({ where: { user_id: userId } });
    if (emailCount === 0) {
      throw new ForbiddenException('Community features require a registered account');
    }
  }

  private assertDateWindow(startAt: Date, endAt: Date): void {
    if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('date.startAt must be a valid ISO date');
    }
    if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('date.endAt must be a valid ISO date');
    }
    if (endAt <= startAt) {
      throw new BadRequestException('date.endAt must be after date.startAt');
    }
  }

  private assertCoordinates(latitude: number, longitude: number): void {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('date latitude and longitude must be valid numbers');
    }
    if (latitude < -90 || latitude > 90) {
      throw new BadRequestException('date latitude must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new BadRequestException('date longitude must be between -180 and 180');
    }
  }

  async createCleanup(userId: string, input: CreateCleanupInput): Promise<{ cleanup: Cleanup; cleanupDate: CleanupDate }> {
    await this.ensureRegisteredUser(userId);
    const trimmedName = input.name?.trim();
    const trimmedDescription = input.description?.trim();
    if (!trimmedName) {
      throw new BadRequestException('name is required');
    }
    const nameNormalized = this.normalizeName(trimmedName);
    const existing = await this.cleanupRepository.findOne({ where: { name_normalized: nameNormalized } });
    if (existing) {
      throw new BadRequestException('Cleanup name already exists');
    }

    this.assertDateWindow(input.date.startAt, input.date.endAt);
    this.assertCoordinates(input.date.latitude, input.date.longitude);

    const cleanup = this.cleanupRepository.create({
      name: trimmedName,
      name_normalized: nameNormalized,
      description: trimmedDescription || '',
      archived_at: null,
      archived_by: null,
    });
    const savedCleanup = await this.cleanupRepository.save(cleanup);

    const cleanupDate = this.cleanupDateRepository.create({
      cleanup_id: savedCleanup.id,
      start_at: input.date.startAt,
      end_at: input.date.endAt,
      latitude: input.date.latitude,
      longitude: input.date.longitude,
      location_name: input.date.locationName?.trim() || null,
    });
    const savedCleanupDate = await this.cleanupDateRepository.save(cleanupDate);

    const participant = this.cleanupParticipantRepository.create({
      cleanup_id: savedCleanup.id,
      user_id: userId,
      role: 'organizer',
    });
    await this.cleanupParticipantRepository.save(participant);

    await this.userRepository.update({ id: userId }, { active_cleanup_date_id: savedCleanupDate.id });

    return {
      cleanup: savedCleanup,
      cleanupDate: savedCleanupDate,
    };
  }

  async getCleanup(cleanupId: string): Promise<{ cleanup: Cleanup; dates: CleanupDate[] }> {
    const cleanup = await this.getCleanupOrThrow(cleanupId);
    if (cleanup.archived_at) {
      throw new NotFoundException('Cleanup not found');
    }
    const dates = await this.cleanupDateRepository.find({
      where: { cleanup_id: cleanupId },
      order: { start_at: 'ASC' },
    });
    return { cleanup, dates };
  }

  async updateCleanup(cleanupId: string, actorUserId: string, input: { name?: string; description?: string }): Promise<Cleanup> {
    await this.ensureRegisteredUser(actorUserId);
    const cleanup = await this.getCleanupOrThrow(cleanupId);
    await this.ensureCleanupNotArchived(cleanup);
    await this.ensureOrganizer(cleanupId, actorUserId);

    if (input.name !== undefined) {
      const trimmedName = input.name.trim();
      if (!trimmedName) throw new BadRequestException('name is required');
      const nameNormalized = this.normalizeName(trimmedName);
      const existing = await this.cleanupRepository.findOne({ where: { name_normalized: nameNormalized } });
      if (existing && existing.id !== cleanupId) throw new BadRequestException('Cleanup name already exists');
      cleanup.name = trimmedName;
      cleanup.name_normalized = nameNormalized;
    }
    if (input.description !== undefined) {
      cleanup.description = input.description.trim();
    }

    return this.cleanupRepository.save(cleanup);
  }

  async getCleanupDetail(cleanupId: string, userId?: string): Promise<{
    cleanup: Cleanup;
    dates: CleanupDate[];
    participants: Array<{ userId: string; nickname: string; role: string; avatarEmailId: string | null }>;
    userRole: string | null;
  }> {
    const { cleanup, dates } = await this.getCleanup(cleanupId);

    const participantRows = await this.cleanupParticipantRepository.find({
      where: { cleanup_id: cleanupId },
      order: { created_at: 'ASC' },
    });

    const userIds = participantRows.map((p) => p.user_id);
    const users = userIds.length > 0
      ? await this.userRepository.find({ where: { id: In(userIds) } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const participants = participantRows.map((p) => {
      const u = userMap.get(p.user_id);
      return {
        userId: p.user_id,
        nickname: u?.nickname || 'Unknown',
        role: p.role,
        avatarEmailId: u?.avatar_email_id || null,
      };
    });

    let userRole: string | null = null;
    if (userId) {
      const participant = participantRows.find((p) => p.user_id === userId);
      userRole = participant?.role || null;
    }

    return { cleanup, dates, participants, userRole };
  }

  async searchCleanups(input: SearchCleanupsInput): Promise<Array<{ cleanup: Cleanup; nearestDate: CleanupDate | null }>> {
    const qb = this.cleanupRepository.createQueryBuilder('cleanup');
    qb.orderBy('cleanup.created_at', 'DESC');

    if (input.query?.trim()) {
      const query = `%${input.query.trim()}%`;
      qb.where('(cleanup.name ILIKE :query OR cleanup.description ILIKE :query)', { query });
    }

    if (input.includeArchived) {
      if (!input.currentUserIsPlatformAdmin) {
        throw new ForbiddenException('Only stewards can include archived cleanups');
      }
    } else {
      qb.andWhere('cleanup.archived_at IS NULL');
    }

    const cleanups = await qb.getMany();
    const now = new Date();
    const date = input.date;

    let participantMap = new Map<string, string>();
    if (input.userId && cleanups.length > 0) {
      const participations = await this.cleanupParticipantRepository.find({
        where: { user_id: input.userId, cleanup_id: In(cleanups.map((c) => c.id)) },
      });
      participantMap = new Map(participations.map((p) => [p.cleanup_id, p.role]));
    }

    const result: Array<{ cleanup: Cleanup; nearestDate: CleanupDate | null; userRole: string | null }> = [];
    for (const cleanup of cleanups) {
      const dates = await this.cleanupDateRepository.find({
        where: { cleanup_id: cleanup.id },
        order: { start_at: 'ASC' },
      });

      const statusMatches = dates.some((cleanupDate) => {
        if (!input.status && !date) return true;

        if (input.status === 'past') {
          return cleanupDate.end_at < now;
        }
        if (input.status === 'ongoing') {
          return cleanupDate.start_at <= now && cleanupDate.end_at >= now;
        }
        if (input.status === 'future') {
          return cleanupDate.start_at > now;
        }
        if (date) {
          const dayStart = new Date(date);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          return cleanupDate.start_at < dayEnd && cleanupDate.end_at >= dayStart;
        }

        return true;
      });

      if (!statusMatches) {
        continue;
      }

      const userRole = participantMap.get(cleanup.id) || null;
      if (input.memberOnly && !userRole) continue;
      const ongoingDate = dates.find((d) => d.start_at <= now && d.end_at >= now);
      const upcomingDate = dates.find((d) => d.start_at > now);
      const nearestDate = ongoingDate || upcomingDate || dates[dates.length - 1] || null;
      result.push({ cleanup, nearestDate, userRole });
    }

    return result;
  }

  async findSimilarCleanups(input: SimilarCleanupsInput): Promise<Array<{ cleanup: Cleanup; score: number; reason: string }>> {
    const nameNormalized = this.normalizeName(input.name || '');
    if (!nameNormalized) {
      return [];
    }

    const candidates = await this.cleanupRepository
      .createQueryBuilder('cleanup')
      .where('cleanup.archived_at IS NULL')
      .andWhere('(cleanup.name_normalized = :exact OR cleanup.name_normalized LIKE :prefix OR cleanup.name ILIKE :contains)', {
        exact: nameNormalized,
        prefix: `${nameNormalized.split(' ')[0]}%`,
        contains: `%${nameNormalized}%`,
      })
      .orderBy('cleanup.created_at', 'DESC')
      .take(20)
      .getMany();

    const results: Array<{ cleanup: Cleanup; score: number; reason: string }> = [];
    for (const candidate of candidates) {
      let score = 0;
      let reason = 'Similar name';

      if (candidate.name_normalized === nameNormalized) {
        score += 100;
        reason = 'Exact name match';
      } else if (candidate.name_normalized.includes(nameNormalized) || nameNormalized.includes(candidate.name_normalized)) {
        score += 60;
      } else {
        score += 30;
      }

      const upcomingDate = await this.cleanupDateRepository.findOne({
        where: { cleanup_id: candidate.id },
        order: { start_at: 'ASC' },
      });

      if (upcomingDate && input.startAt) {
        const millisDelta = Math.abs(upcomingDate.start_at.getTime() - input.startAt.getTime());
        const daysDelta = millisDelta / (1000 * 60 * 60 * 24);
        if (daysDelta <= 7) {
          score += 20;
          reason = `${reason}, close in date`;
        }
      }

      if (
        upcomingDate &&
        Number.isFinite(input.latitude) &&
        Number.isFinite(input.longitude)
      ) {
        const distance = this.distanceKm(
          input.latitude as number,
          input.longitude as number,
          upcomingDate.latitude,
          upcomingDate.longitude,
        );
        if (distance <= 15) {
          score += 20;
          reason = `${reason}, nearby location`;
        }
      }

      results.push({ cleanup: candidate, score, reason });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  async joinCleanup(cleanupId: string, userId: string): Promise<{ joined: boolean }> {
    await this.ensureRegisteredUser(userId);
    const cleanup = await this.getCleanupOrThrow(cleanupId);
    await this.ensureCleanupNotArchived(cleanup);

    const existing = await this.getParticipant(cleanupId, userId);
    if (existing) {
      return { joined: false };
    }

    const participant = this.cleanupParticipantRepository.create({
      cleanup_id: cleanupId,
      user_id: userId,
      role: 'member',
    });
    await this.cleanupParticipantRepository.save(participant);
    return { joined: true };
  }

  async leaveCleanup(cleanupId: string, userId: string): Promise<{ left: boolean }> {
    await this.ensureRegisteredUser(userId);
    const participant = await this.getParticipant(cleanupId, userId);
    if (!participant) {
      return { left: false };
    }

    if (participant.role === 'organizer') {
      const organizerCount = await this.cleanupParticipantRepository.count({ where: { cleanup_id: cleanupId, role: 'organizer' } });
      if (organizerCount <= 1) {
        await this.promoteStewards(cleanupId, userId);
      }
    }

    await this.cleanupParticipantRepository.delete({ id: participant.id });

    const activeDate = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'active_cleanup_date_id'],
    });
    if (activeDate?.active_cleanup_date_id) {
      const cleanupDate = await this.cleanupDateRepository.findOne({
        where: { id: activeDate.active_cleanup_date_id },
      });
      if (cleanupDate?.cleanup_id === cleanupId) {
        await this.userRepository.update({ id: userId }, { active_cleanup_date_id: null });
      }
    }

    return { left: true };
  }

  private async promoteStewards(cleanupId: string, leavingUserId: string): Promise<void> {
    const allStewardIds = await this.adminService.getAdminUserIds();
    const stewardIds = allStewardIds.filter((id) => id !== leavingUserId);
    if (stewardIds.length === 0) {
      throw new BadRequestException('Cannot leave cleanup because no stewards are available for fallback promotion');
    }

    const existingParticipants = await this.cleanupParticipantRepository.find({
      where: {
        cleanup_id: cleanupId,
        user_id: In(stewardIds),
      },
    });
    const participantByUserId = new Map(existingParticipants.map((participant) => [participant.user_id, participant]));

    for (const stewardId of stewardIds) {
      const existing = participantByUserId.get(stewardId);
      if (!existing) {
        const participant = this.cleanupParticipantRepository.create({
          cleanup_id: cleanupId,
          user_id: stewardId,
          role: 'organizer',
        });
        await this.cleanupParticipantRepository.save(participant);
        continue;
      }

      if (existing.role !== 'organizer') {
        existing.role = 'organizer';
        await this.cleanupParticipantRepository.save(existing);
      }
    }
  }

  async addDate(
    cleanupId: string,
    actorUserId: string,
    payload: {
      startAt: Date;
      endAt: Date;
      latitude: number;
      longitude: number;
      locationName?: string;
    },
  ): Promise<CleanupDate> {
    await this.ensureRegisteredUser(actorUserId);
    const cleanup = await this.getCleanupOrThrow(cleanupId);
    await this.ensureCleanupNotArchived(cleanup);
    await this.ensureOrganizer(cleanupId, actorUserId);

    this.assertDateWindow(payload.startAt, payload.endAt);
    this.assertCoordinates(payload.latitude, payload.longitude);

    const cleanupDate = this.cleanupDateRepository.create({
      cleanup_id: cleanupId,
      start_at: payload.startAt,
      end_at: payload.endAt,
      latitude: payload.latitude,
      longitude: payload.longitude,
      location_name: payload.locationName?.trim() || null,
    });

    return this.cleanupDateRepository.save(cleanupDate);
  }

  async addDatesBulk(
    cleanupId: string,
    actorUserId: string,
    payload: {
      recurrenceId: string;
      dates: Array<{
        startAt: Date;
        endAt: Date;
        latitude: number;
        longitude: number;
        locationName?: string;
      }>;
    },
  ): Promise<CleanupDate[]> {
    await this.ensureRegisteredUser(actorUserId);
    const cleanup = await this.getCleanupOrThrow(cleanupId);
    await this.ensureCleanupNotArchived(cleanup);
    await this.ensureOrganizer(cleanupId, actorUserId);

    const entities: CleanupDate[] = [];
    for (const d of payload.dates) {
      this.assertDateWindow(d.startAt, d.endAt);
      this.assertCoordinates(d.latitude, d.longitude);
      entities.push(this.cleanupDateRepository.create({
        cleanup_id: cleanupId,
        start_at: d.startAt,
        end_at: d.endAt,
        latitude: d.latitude,
        longitude: d.longitude,
        location_name: d.locationName?.trim() || null,
        recurrence_id: payload.recurrenceId,
      }));
    }

    return this.cleanupDateRepository.save(entities);
  }

  async deleteDatesBulk(cleanupId: string, actorUserId: string, dateIds: string[]): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    await this.getCleanupOrThrow(cleanupId);
    await this.ensureOrganizer(cleanupId, actorUserId);

    if (dateIds.length === 0) return;

    // Verify all dates belong to this cleanup
    const dates = await this.cleanupDateRepository.find({ where: { cleanup_id: cleanupId, id: In(dateIds) } });
    if (dates.length !== dateIds.length) {
      throw new BadRequestException('Some date IDs do not belong to this cleanup');
    }

    // Clear active_cleanup_date_id for affected users
    await this.userRepository
      .createQueryBuilder()
      .update()
      .set({ active_cleanup_date_id: null })
      .where('active_cleanup_date_id IN (:...dateIds)', { dateIds })
      .execute();

    await this.cleanupDateRepository.delete(dateIds);
  }

  async updateDate(
    cleanupDateId: string,
    actorUserId: string,
    payload: {
      startAt: Date;
      endAt: Date;
      latitude: number;
      longitude: number;
      locationName?: string;
    },
  ): Promise<CleanupDate> {
    await this.ensureRegisteredUser(actorUserId);
    const cleanupDate = await this.cleanupDateRepository.findOne({ where: { id: cleanupDateId }, relations: ['cleanup'] });
    if (!cleanupDate) {
      throw new NotFoundException('Cleanup date not found');
    }
    await this.ensureCleanupNotArchived(cleanupDate.cleanup);
    await this.ensureOrganizer(cleanupDate.cleanup_id, actorUserId);

    this.assertDateWindow(payload.startAt, payload.endAt);
    this.assertCoordinates(payload.latitude, payload.longitude);

    cleanupDate.start_at = payload.startAt;
    cleanupDate.end_at = payload.endAt;
    cleanupDate.latitude = payload.latitude;
    cleanupDate.longitude = payload.longitude;
    cleanupDate.location_name = payload.locationName?.trim() || null;

    return this.cleanupDateRepository.save(cleanupDate);
  }

  async deleteDate(cleanupDateId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const cleanupDate = await this.cleanupDateRepository.findOne({ where: { id: cleanupDateId }, relations: ['cleanup'] });
    if (!cleanupDate) {
      throw new NotFoundException('Cleanup date not found');
    }
    await this.ensureCleanupNotArchived(cleanupDate.cleanup);
    await this.ensureOrganizer(cleanupDate.cleanup_id, actorUserId);

    // Clear active_cleanup_date_id for any user who has this date active
    await this.userRepository.update({ active_cleanup_date_id: cleanupDateId }, { active_cleanup_date_id: null });

    await this.cleanupDateRepository.delete({ id: cleanupDateId });
  }

  async activateDate(cleanupDateId: string, userId: string): Promise<{ activeCleanupDateId: string }> {
    await this.ensureRegisteredUser(userId);
    const cleanupDate = await this.cleanupDateRepository.findOne({ where: { id: cleanupDateId }, relations: ['cleanup'] });
    if (!cleanupDate) {
      throw new NotFoundException('Cleanup date not found');
    }
    if (cleanupDate.cleanup.archived_at) {
      throw new BadRequestException('Cleanup is archived');
    }

    await this.getParticipantOrThrow(cleanupDate.cleanup_id, userId);

    const now = new Date();
    if (now < cleanupDate.start_at || now > cleanupDate.end_at) {
      throw new BadRequestException('Cleanup date can only be activated while ongoing');
    }

    await this.userRepository.update({ id: userId }, { active_cleanup_date_id: cleanupDateId });
    return { activeCleanupDateId: cleanupDateId };
  }

  async deactivateDate(userId: string): Promise<void> {
    await this.userRepository.update({ id: userId }, { active_cleanup_date_id: null });
  }

  async promoteParticipant(cleanupId: string, targetUserId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const cleanup = await this.getCleanupOrThrow(cleanupId);
    await this.ensureCleanupNotArchived(cleanup);
    await this.ensureOrganizer(cleanupId, actorUserId);

    const participant = await this.getParticipant(cleanupId, targetUserId);
    if (!participant) {
      throw new NotFoundException('Target user is not a cleanup participant');
    }
    if (participant.role === 'organizer') {
      return;
    }
    participant.role = 'organizer';
    await this.cleanupParticipantRepository.save(participant);
  }

  async archiveCleanup(cleanupId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const cleanup = await this.getCleanupOrThrow(cleanupId);
    await this.ensureOrganizer(cleanupId, actorUserId);
    if (cleanup.archived_at) {
      return;
    }
    cleanup.archived_at = new Date();
    cleanup.archived_by = actorUserId;
    await this.cleanupRepository.save(cleanup);

    await this.userRepository.query(
      `
        UPDATE users
        SET active_cleanup_date_id = NULL
        WHERE active_cleanup_date_id IN (
          SELECT id
          FROM cleanup_dates
          WHERE cleanup_id = $1
        )
      `,
      [cleanupId],
    );
  }

  async listMessages(cleanupId: string, userId: string): Promise<Array<CleanupMessage & { author?: { nickname: string; avatarEmailId: string | null } }>> {
    await this.ensureRegisteredUser(userId);
    const participant = await this.getParticipant(cleanupId, userId);
    if (!participant) {
      const isPlatformAdmin = await this.adminService.isAdmin(userId);
      if (!isPlatformAdmin) {
        throw new ForbiddenException('You are not allowed to view cleanup messages');
      }
    }
    const messages = await this.cleanupMessageRepository.find({
      where: { cleanup_id: cleanupId },
      order: { created_at: 'DESC' },
      take: 100,
    });

    const authorIds = [...new Set(messages.map((m) => m.author_user_id))];
    const authors = authorIds.length > 0
      ? await this.userRepository.find({ where: { id: In(authorIds) } })
      : [];
    const authorMap = new Map(authors.map((a) => [a.id, a]));

    return messages.map((m) => {
      const author = authorMap.get(m.author_user_id);
      return Object.assign(m, {
        author: author
          ? { nickname: author.nickname, avatarEmailId: author.avatar_email_id }
          : undefined,
      });
    });
  }

  async createMessage(input: CreateCleanupMessageInput): Promise<CleanupMessage> {
    await this.ensureRegisteredUser(input.authorUserId);
    const cleanup = await this.getCleanupOrThrow(input.cleanupId);
    await this.ensureCleanupNotArchived(cleanup);
    const participant = await this.getParticipantOrThrow(input.cleanupId, input.authorUserId);

    const subject = input.subject?.trim();
    const body = input.body?.trim();
    if (!subject) {
      throw new BadRequestException('subject is required');
    }
    if (!body) {
      throw new BadRequestException('body is required');
    }

    if (participant.role !== 'organizer' && input.audience !== 'organizers') {
      throw new ForbiddenException('Cleanup members can only message cleanup organizers');
    }

    const message = this.cleanupMessageRepository.create({
      cleanup_id: input.cleanupId,
      author_user_id: input.authorUserId,
      audience: input.audience,
      subject,
      body,
    });
    const saved = await this.cleanupMessageRepository.save(message);
    await this.sendCleanupMessageEmailFanout(cleanup.name, saved, input.authorUserId);
    return saved;
  }

  private async sendCleanupMessageEmailFanout(cleanupName: string, message: CleanupMessage, authorUserId: string): Promise<void> {
    // 'members' audience → all participants (member + organizer); 'organizers' audience → organizers only
    const recipients = message.audience === 'organizers'
      ? await this.cleanupParticipantRepository.find({ where: { cleanup_id: message.cleanup_id, role: 'organizer' } })
      : await this.cleanupParticipantRepository.find({ where: { cleanup_id: message.cleanup_id } });

    const recipientIds = recipients.map((r) => r.user_id).filter((id) => id !== authorUserId);

    const recipientEmails = recipientIds.length > 0
      ? await this.userEmailRepository.find({ where: { user_id: In(recipientIds), is_selected_for_login: true } })
      : [];

    // CC the sender so they get a copy
    const senderEmails = await this.userEmailRepository.find({ where: { user_id: authorUserId, is_selected_for_login: true } });
    const senderEmail = senderEmails[0]?.email || null;

    const uniqueRecipientEmails = [...new Set(recipientEmails.map((e) => e.email))];
    await this.emailService.sendCommunityMessage(uniqueRecipientEmails, senderEmail, {
      subject: `[Cleanup: ${cleanupName}] ${message.subject}`,
      preheader: 'New cleanup message in Cleancentive',
      title: cleanupName,
      body: message.body,
      disclosure: 'Stewards can read team and cleanup messages for moderation purposes.',
    });
  }

  async resolveActiveCleanupDateForSpot(
    userId: string,
    spotLatitude: number,
    spotLongitude: number,
  ): Promise<ActiveCleanupDateResolution> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'active_cleanup_date_id'],
    });

    if (!user?.active_cleanup_date_id) {
      return {
        cleanupId: null,
        cleanupDateId: null,
        warning: null,
      };
    }

    const cleanupDate = await this.cleanupDateRepository.findOne({
      where: { id: user.active_cleanup_date_id },
      relations: ['cleanup'],
    });

    if (!cleanupDate || cleanupDate.cleanup.archived_at) {
      await this.userRepository.update({ id: userId }, { active_cleanup_date_id: null });
      return { cleanupId: null, cleanupDateId: null, warning: null };
    }

    const participant = await this.getParticipant(cleanupDate.cleanup_id, userId);
    if (!participant) {
      await this.userRepository.update({ id: userId }, { active_cleanup_date_id: null });
      return { cleanupId: null, cleanupDateId: null, warning: null };
    }

    const now = new Date();
    if (now < cleanupDate.start_at || now > cleanupDate.end_at) {
      await this.userRepository.update({ id: userId }, { active_cleanup_date_id: null });
      return { cleanupId: null, cleanupDateId: null, warning: null };
    }

    const distanceKm = this.distanceKm(spotLatitude, spotLongitude, cleanupDate.latitude, cleanupDate.longitude);
    const warning = distanceKm > this.warningThresholdKm
      ? `Your spot is ${distanceKm.toFixed(1)}km away from the active cleanup location.`
      : null;

    return {
      cleanupId: cleanupDate.cleanup_id,
      cleanupDateId: cleanupDate.id,
      warning,
    };
  }

  async getParticipatedCleanupDates(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      cleanupDateId: string;
      cleanupId: string;
      cleanupName: string;
      startAt: string;
      endAt: string;
      latitude: number;
      longitude: number;
      locationName: string | null;
    }>
  > {
    const participations = await this.cleanupParticipantRepository.find({
      where: { user_id: userId },
      select: ['cleanup_id'],
    });

    if (participations.length === 0) {
      return [];
    }

    const cleanupIds = participations.map((p) => p.cleanup_id);

    const paddedFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000);
    const paddedTo = new Date(to.getTime() + 24 * 60 * 60 * 1000);

    const dates = await this.cleanupDateRepository
      .createQueryBuilder('cd')
      .innerJoin('cd.cleanup', 'cleanup')
      .addSelect(['cleanup.id', 'cleanup.name', 'cleanup.archived_at'])
      .where('cd.cleanup_id IN (:...cleanupIds)', { cleanupIds })
      .andWhere('cleanup.archived_at IS NULL')
      .andWhere('cd.start_at <= :paddedTo', { paddedTo })
      .andWhere('cd.end_at >= :paddedFrom', { paddedFrom })
      .orderBy('cd.start_at', 'DESC')
      .getMany();

    return dates.map((d) => ({
      cleanupDateId: d.id,
      cleanupId: d.cleanup_id,
      cleanupName: d.cleanup.name,
      startAt: d.start_at.toISOString(),
      endAt: d.end_at.toISOString(),
      latitude: d.latitude,
      longitude: d.longitude,
      locationName: d.location_name,
    }));
  }

  async validateExplicitCleanupAssociation(
    userId: string,
    cleanupId: string,
    cleanupDateId: string,
    capturedAt: Date,
  ): Promise<{ valid: boolean; warning: string | null }> {
    const cleanupDate = await this.cleanupDateRepository.findOne({
      where: { id: cleanupDateId },
      relations: ['cleanup'],
    });

    if (!cleanupDate || cleanupDate.cleanup_id !== cleanupId) {
      return { valid: false, warning: 'Cleanup date not found or does not belong to the specified cleanup.' };
    }

    if (cleanupDate.cleanup.archived_at) {
      return { valid: false, warning: 'Cleanup is archived.' };
    }

    const participant = await this.getParticipant(cleanupId, userId);
    if (!participant) {
      return { valid: false, warning: 'You are not a participant of this cleanup.' };
    }

    const graceMs = 30 * 60 * 1000;
    const windowStart = new Date(cleanupDate.start_at.getTime() - graceMs);
    const windowEnd = new Date(cleanupDate.end_at.getTime() + graceMs);

    if (capturedAt < windowStart || capturedAt > windowEnd) {
      return { valid: false, warning: 'Photo was not taken during this cleanup.' };
    }

    return { valid: true, warning: null };
  }

  private distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRadians = (degrees: number) => degrees * (Math.PI / 180);
    const earthRadiusKm = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }
}
