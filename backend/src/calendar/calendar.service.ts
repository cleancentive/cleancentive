import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, Repository } from 'typeorm';
import { Cleanup } from '../cleanup/cleanup.entity';
import { CleanupDate } from '../cleanup/cleanup-date.entity';
import { CleanupParticipant } from '../cleanup/cleanup-participant.entity';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { buildFeed, buildSingleEventIcs, CalendarEventInput } from './ics-builder';

const DISCOVER_WINDOW_DAYS = 60;

@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(Cleanup) private readonly cleanupRepository: Repository<Cleanup>,
    @InjectRepository(CleanupDate) private readonly cleanupDateRepository: Repository<CleanupDate>,
    @InjectRepository(CleanupParticipant) private readonly participantRepository: Repository<CleanupParticipant>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  getAppBaseUrl(): string {
    return (
      this.configService.get<string>('APP_BASE_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:5173'
    ).replace(/\/+$/, '');
  }

  getApiBaseUrl(): string {
    return (this.configService.get<string>('API_BASE_URL') || `${this.getAppBaseUrl()}/api/v1`).replace(/\/+$/, '');
  }

  feedUrls(userId: string): { joinedHttp: string; joinedWebcal: string; discoverHttp: string; discoverWebcal: string } {
    const api = this.getApiBaseUrl();
    const joinedHttp = `${api}/calendar/${userId}/joined.ics`;
    const discoverHttp = `${api}/calendar/${userId}/discover.ics`;
    return {
      joinedHttp,
      discoverHttp,
      joinedWebcal: joinedHttp.replace(/^https?:/, 'webcal:'),
      discoverWebcal: discoverHttp.replace(/^https?:/, 'webcal:'),
    };
  }

  async ensureUserExists(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async recordFeedFetch(userId: string): Promise<{ wasFirstFetch: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        select: ['id', 'calendar_feed_last_fetched_at'],
      });
      const wasFirstFetch = !user?.calendar_feed_last_fetched_at;
      await manager.getRepository(User).update({ id: userId }, { calendar_feed_last_fetched_at: new Date() });
      if (wasFirstFetch) {
        await manager
          .getRepository(UserEmail)
          .createQueryBuilder()
          .update()
          .set({ calendar_emails_enabled: false })
          .where('user_id = :userId', { userId })
          .execute();
      }
      return { wasFirstFetch };
    });
  }

  private async loadEventsForCleanupDates(cleanupDates: CleanupDate[]): Promise<CalendarEventInput[]> {
    if (cleanupDates.length === 0) return [];
    const cleanupIds = [...new Set(cleanupDates.map((d) => d.cleanup_id))];
    const cleanups = await this.cleanupRepository.find({ where: { id: In(cleanupIds) } });
    const cleanupMap = new Map(cleanups.map((c) => [c.id, c]));
    return cleanupDates
      .map((d): CalendarEventInput | null => {
        const c = cleanupMap.get(d.cleanup_id);
        if (!c || c.archived_at) return null;
        return {
          cleanupDateId: d.id,
          cleanupId: d.cleanup_id,
          cleanupName: c.name,
          cleanupDescription: c.description || '',
          startAt: d.start_at,
          endAt: d.end_at,
          latitude: d.latitude,
          longitude: d.longitude,
          locationName: d.location_name,
        };
      })
      .filter((e): e is CalendarEventInput => e !== null);
  }

  async buildJoinedFeed(userId: string): Promise<string> {
    const participations = await this.participantRepository.find({
      where: { user_id: userId },
      select: ['cleanup_id'],
    });
    const cleanupIds = participations.map((p) => p.cleanup_id);
    const dates = cleanupIds.length > 0
      ? await this.cleanupDateRepository.find({
          where: { cleanup_id: In(cleanupIds) },
          order: { start_at: 'ASC' },
        })
      : [];
    const events = await this.loadEventsForCleanupDates(dates);
    return buildFeed(events, this.getAppBaseUrl(), 'CleanCentive — My Cleanups');
  }

  async buildDiscoverFeed(userId: string): Promise<string> {
    const participations = await this.participantRepository.find({
      where: { user_id: userId },
      select: ['cleanup_id'],
    });
    const joinedCleanupIds = new Set(participations.map((p) => p.cleanup_id));
    const now = new Date();
    const horizon = new Date(now.getTime() + DISCOVER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const qb = this.cleanupDateRepository
      .createQueryBuilder('cd')
      .innerJoin('cd.cleanup', 'cleanup')
      .where('cleanup.archived_at IS NULL')
      .andWhere('cd.start_at >= :now', { now })
      .andWhere('cd.start_at <= :horizon', { horizon })
      .orderBy('cd.start_at', 'ASC');

    if (joinedCleanupIds.size > 0) {
      qb.andWhere('cd.cleanup_id NOT IN (:...joinedCleanupIds)', { joinedCleanupIds: [...joinedCleanupIds] });
    }

    const dates = await qb.getMany();
    const events = await this.loadEventsForCleanupDates(dates);
    return buildFeed(events, this.getAppBaseUrl(), 'CleanCentive — Discover Cleanups');
  }

  async buildSingleEvent(cleanupDateId: string): Promise<string> {
    const cleanupDate = await this.cleanupDateRepository.findOne({
      where: { id: cleanupDateId },
      relations: ['cleanup'],
    });
    if (!cleanupDate || cleanupDate.cleanup?.archived_at) {
      throw new NotFoundException('Cleanup date not found');
    }
    const event: CalendarEventInput = {
      cleanupDateId: cleanupDate.id,
      cleanupId: cleanupDate.cleanup_id,
      cleanupName: cleanupDate.cleanup.name,
      cleanupDescription: cleanupDate.cleanup.description || '',
      startAt: cleanupDate.start_at,
      endAt: cleanupDate.end_at,
      latitude: cleanupDate.latitude,
      longitude: cleanupDate.longitude,
      locationName: cleanupDate.location_name,
    };
    return buildSingleEventIcs(event, this.getAppBaseUrl(), { method: 'PUBLISH', sequence: 0 });
  }

  async buildSingleEventForEmail(
    cleanupDateId: string,
    method: 'REQUEST' | 'CANCEL',
    sequence: number,
  ): Promise<{ ics: string; event: CalendarEventInput }> {
    const cleanupDate = await this.cleanupDateRepository.findOne({
      where: { id: cleanupDateId },
      relations: ['cleanup'],
    });
    if (!cleanupDate) {
      throw new NotFoundException('Cleanup date not found');
    }
    const event: CalendarEventInput = {
      cleanupDateId: cleanupDate.id,
      cleanupId: cleanupDate.cleanup_id,
      cleanupName: cleanupDate.cleanup.name,
      cleanupDescription: cleanupDate.cleanup.description || '',
      startAt: cleanupDate.start_at,
      endAt: cleanupDate.end_at,
      latitude: cleanupDate.latitude,
      longitude: cleanupDate.longitude,
      locationName: cleanupDate.location_name,
    };
    const ics = buildSingleEventIcs(event, this.getAppBaseUrl(), { method, sequence });
    return { ics, event };
  }

}
