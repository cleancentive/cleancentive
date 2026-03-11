import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Event } from './event.entity';
import { EventOccurrence } from './event-occurrence.entity';
import { EventParticipant } from './event-participant.entity';
import { EventMessage } from './event-message.entity';
import { User } from '../user/user.entity';
import { UserEmail } from '../user/user-email.entity';
import { AdminService } from '../admin/admin.service';
import { EmailService } from '../email/email.service';

interface CreateEventInput {
  name: string;
  description: string;
  occurrence: {
    startAt: Date;
    endAt: Date;
    latitude: number;
    longitude: number;
    locationName?: string;
  };
}

interface SearchEventsInput {
  query?: string;
  status?: 'past' | 'ongoing' | 'future';
  date?: Date;
  includeArchived?: boolean;
  currentUserIsPlatformAdmin: boolean;
}

interface CreateEventMessageInput {
  eventId: string;
  authorUserId: string;
  audience: 'members' | 'admins';
  subject: string;
  body: string;
}

interface SimilarEventsInput {
  name: string;
  startAt?: Date;
  latitude?: number;
  longitude?: number;
}

interface ActiveOccurrenceResolution {
  eventId: string | null;
  occurrenceId: string | null;
  warning: string | null;
}

@Injectable()
export class EventService {
  private readonly warningThresholdKm = 15;

  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectRepository(EventOccurrence)
    private readonly eventOccurrenceRepository: Repository<EventOccurrence>,
    @InjectRepository(EventParticipant)
    private readonly eventParticipantRepository: Repository<EventParticipant>,
    @InjectRepository(EventMessage)
    private readonly eventMessageRepository: Repository<EventMessage>,
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

  private async getEventOrThrow(eventId: string): Promise<Event> {
    const event = await this.eventRepository.findOne({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async ensureEventNotArchived(event: Event): Promise<void> {
    if (event.archived_at) {
      throw new BadRequestException('Event is archived');
    }
  }

  private async getParticipant(eventId: string, userId: string): Promise<EventParticipant | null> {
    return this.eventParticipantRepository.findOne({ where: { event_id: eventId, user_id: userId } });
  }

  private async getParticipantOrThrow(eventId: string, userId: string): Promise<EventParticipant> {
    const participant = await this.getParticipant(eventId, userId);
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this event');
    }
    return participant;
  }

  private async ensureAdmin(eventId: string, userId: string): Promise<EventParticipant> {
    const participant = await this.getParticipantOrThrow(eventId, userId);
    if (participant.role !== 'admin') {
      throw new ForbiddenException('Event admin permissions required');
    }
    return participant;
  }

  private async ensureRegisteredUser(userId: string): Promise<void> {
    const emailCount = await this.userEmailRepository.count({ where: { user_id: userId } });
    if (emailCount === 0) {
      throw new ForbiddenException('Community features require a registered account');
    }
  }

  private assertOccurrenceWindow(startAt: Date, endAt: Date): void {
    if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('occurrence.startAt must be a valid ISO date');
    }
    if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('occurrence.endAt must be a valid ISO date');
    }
    if (endAt <= startAt) {
      throw new BadRequestException('occurrence.endAt must be after occurrence.startAt');
    }
  }

  private assertCoordinates(latitude: number, longitude: number): void {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('occurrence latitude and longitude must be valid numbers');
    }
    if (latitude < -90 || latitude > 90) {
      throw new BadRequestException('occurrence latitude must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new BadRequestException('occurrence longitude must be between -180 and 180');
    }
  }

  async createEvent(userId: string, input: CreateEventInput): Promise<{ event: Event; occurrence: EventOccurrence }> {
    await this.ensureRegisteredUser(userId);
    const trimmedName = input.name?.trim();
    const trimmedDescription = input.description?.trim();
    if (!trimmedName) {
      throw new BadRequestException('name is required');
    }
    if (!trimmedDescription) {
      throw new BadRequestException('description is required');
    }

    const nameNormalized = this.normalizeName(trimmedName);
    const existing = await this.eventRepository.findOne({ where: { name_normalized: nameNormalized } });
    if (existing) {
      throw new BadRequestException('Event name already exists');
    }

    this.assertOccurrenceWindow(input.occurrence.startAt, input.occurrence.endAt);
    this.assertCoordinates(input.occurrence.latitude, input.occurrence.longitude);

    const event = this.eventRepository.create({
      name: trimmedName,
      name_normalized: nameNormalized,
      description: trimmedDescription,
      created_by: userId,
      updated_by: userId,
      archived_at: null,
      archived_by: null,
    });
    const savedEvent = await this.eventRepository.save(event);

    const occurrence = this.eventOccurrenceRepository.create({
      event_id: savedEvent.id,
      start_at: input.occurrence.startAt,
      end_at: input.occurrence.endAt,
      latitude: input.occurrence.latitude,
      longitude: input.occurrence.longitude,
      location_name: input.occurrence.locationName?.trim() || null,
      created_by: userId,
      updated_by: userId,
    });
    const savedOccurrence = await this.eventOccurrenceRepository.save(occurrence);

    const participant = this.eventParticipantRepository.create({
      event_id: savedEvent.id,
      user_id: userId,
      role: 'admin',
      created_by: userId,
      updated_by: userId,
    });
    await this.eventParticipantRepository.save(participant);

    await this.userRepository.update({ id: userId }, { active_event_occurrence_id: savedOccurrence.id });

    return {
      event: savedEvent,
      occurrence: savedOccurrence,
    };
  }

  async getEvent(eventId: string): Promise<{ event: Event; occurrences: EventOccurrence[] }> {
    const event = await this.getEventOrThrow(eventId);
    if (event.archived_at) {
      throw new NotFoundException('Event not found');
    }
    const occurrences = await this.eventOccurrenceRepository.find({
      where: { event_id: eventId },
      order: { start_at: 'ASC' },
    });
    return { event, occurrences };
  }

  async searchEvents(input: SearchEventsInput): Promise<Array<{ event: Event; nearestOccurrence: EventOccurrence | null }>> {
    const qb = this.eventRepository.createQueryBuilder('event');
    qb.orderBy('event.created_at', 'DESC');

    if (input.query?.trim()) {
      const query = `%${input.query.trim()}%`;
      qb.where('(event.name ILIKE :query OR event.description ILIKE :query)', { query });
    }

    if (input.includeArchived) {
      if (!input.currentUserIsPlatformAdmin) {
        throw new ForbiddenException('Only platform admins can include archived events');
      }
    } else {
      qb.andWhere('event.archived_at IS NULL');
    }

    const events = await qb.getMany();
    const now = new Date();
    const date = input.date;

    const result: Array<{ event: Event; nearestOccurrence: EventOccurrence | null }> = [];
    for (const event of events) {
      const occurrences = await this.eventOccurrenceRepository.find({
        where: { event_id: event.id },
        order: { start_at: 'ASC' },
      });

      const statusMatches = occurrences.some((occurrence) => {
        if (!input.status && !date) return true;

        if (input.status === 'past') {
          return occurrence.end_at < now;
        }
        if (input.status === 'ongoing') {
          return occurrence.start_at <= now && occurrence.end_at >= now;
        }
        if (input.status === 'future') {
          return occurrence.start_at > now;
        }
        if (date) {
          const dayStart = new Date(date);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          return occurrence.start_at < dayEnd && occurrence.end_at >= dayStart;
        }

        return true;
      });

      if (!statusMatches) {
        continue;
      }

      const nearestOccurrence = occurrences[0] || null;
      result.push({ event, nearestOccurrence });
    }

    return result;
  }

  async findSimilarEvents(input: SimilarEventsInput): Promise<Array<{ event: Event; score: number; reason: string }>> {
    const nameNormalized = this.normalizeName(input.name || '');
    if (!nameNormalized) {
      return [];
    }

    const candidates = await this.eventRepository
      .createQueryBuilder('event')
      .where('event.archived_at IS NULL')
      .andWhere('(event.name_normalized = :exact OR event.name_normalized LIKE :prefix OR event.name ILIKE :contains)', {
        exact: nameNormalized,
        prefix: `${nameNormalized.split(' ')[0]}%`,
        contains: `%${nameNormalized}%`,
      })
      .orderBy('event.created_at', 'DESC')
      .take(20)
      .getMany();

    const results: Array<{ event: Event; score: number; reason: string }> = [];
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

      const upcomingOccurrence = await this.eventOccurrenceRepository.findOne({
        where: { event_id: candidate.id },
        order: { start_at: 'ASC' },
      });

      if (upcomingOccurrence && input.startAt) {
        const millisDelta = Math.abs(upcomingOccurrence.start_at.getTime() - input.startAt.getTime());
        const daysDelta = millisDelta / (1000 * 60 * 60 * 24);
        if (daysDelta <= 7) {
          score += 20;
          reason = `${reason}, close in date`;
        }
      }

      if (
        upcomingOccurrence &&
        Number.isFinite(input.latitude) &&
        Number.isFinite(input.longitude)
      ) {
        const distance = this.distanceKm(
          input.latitude as number,
          input.longitude as number,
          upcomingOccurrence.latitude,
          upcomingOccurrence.longitude,
        );
        if (distance <= 15) {
          score += 20;
          reason = `${reason}, nearby location`;
        }
      }

      results.push({ event: candidate, score, reason });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  async joinEvent(eventId: string, userId: string): Promise<{ joined: boolean }> {
    await this.ensureRegisteredUser(userId);
    const event = await this.getEventOrThrow(eventId);
    await this.ensureEventNotArchived(event);

    const existing = await this.getParticipant(eventId, userId);
    if (existing) {
      return { joined: false };
    }

    const participant = this.eventParticipantRepository.create({
      event_id: eventId,
      user_id: userId,
      role: 'member',
      created_by: userId,
      updated_by: userId,
    });
    await this.eventParticipantRepository.save(participant);
    return { joined: true };
  }

  async leaveEvent(eventId: string, userId: string): Promise<{ left: boolean }> {
    await this.ensureRegisteredUser(userId);
    const participant = await this.getParticipant(eventId, userId);
    if (!participant) {
      return { left: false };
    }

    if (participant.role === 'admin') {
      const adminCount = await this.eventParticipantRepository.count({ where: { event_id: eventId, role: 'admin' } });
      if (adminCount <= 1) {
        await this.promotePlatformAdmins(eventId, userId);
      }
    }

    await this.eventParticipantRepository.delete({ id: participant.id });

    const activeOccurrence = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'active_event_occurrence_id'],
    });
    if (activeOccurrence?.active_event_occurrence_id) {
      const occurrence = await this.eventOccurrenceRepository.findOne({
        where: { id: activeOccurrence.active_event_occurrence_id },
      });
      if (occurrence?.event_id === eventId) {
        await this.userRepository.update({ id: userId }, { active_event_occurrence_id: null });
      }
    }

    return { left: true };
  }

  private async promotePlatformAdmins(eventId: string, updatedBy: string): Promise<void> {
    const platformAdminIds = await this.adminService.getAdminUserIds();
    if (platformAdminIds.length === 0) {
      throw new BadRequestException('Cannot leave event because no platform admins are available for fallback promotion');
    }

    const existingParticipants = await this.eventParticipantRepository.find({
      where: {
        event_id: eventId,
        user_id: In(platformAdminIds),
      },
    });
    const participantByUserId = new Map(existingParticipants.map((participant) => [participant.user_id, participant]));

    for (const platformAdminId of platformAdminIds) {
      const existing = participantByUserId.get(platformAdminId);
      if (!existing) {
        const participant = this.eventParticipantRepository.create({
          event_id: eventId,
          user_id: platformAdminId,
          role: 'admin',
          created_by: updatedBy,
          updated_by: updatedBy,
        });
        await this.eventParticipantRepository.save(participant);
        continue;
      }

      if (existing.role !== 'admin') {
        existing.role = 'admin';
        existing.updated_by = updatedBy;
        await this.eventParticipantRepository.save(existing);
      }
    }
  }

  async addOccurrence(
    eventId: string,
    actorUserId: string,
    payload: {
      startAt: Date;
      endAt: Date;
      latitude: number;
      longitude: number;
      locationName?: string;
    },
  ): Promise<EventOccurrence> {
    await this.ensureRegisteredUser(actorUserId);
    const event = await this.getEventOrThrow(eventId);
    await this.ensureEventNotArchived(event);
    await this.ensureAdmin(eventId, actorUserId);

    this.assertOccurrenceWindow(payload.startAt, payload.endAt);
    this.assertCoordinates(payload.latitude, payload.longitude);

    const occurrence = this.eventOccurrenceRepository.create({
      event_id: eventId,
      start_at: payload.startAt,
      end_at: payload.endAt,
      latitude: payload.latitude,
      longitude: payload.longitude,
      location_name: payload.locationName?.trim() || null,
      created_by: actorUserId,
      updated_by: actorUserId,
    });

    return this.eventOccurrenceRepository.save(occurrence);
  }

  async activateOccurrence(occurrenceId: string, userId: string): Promise<{ activeEventOccurrenceId: string }> {
    await this.ensureRegisteredUser(userId);
    const occurrence = await this.eventOccurrenceRepository.findOne({ where: { id: occurrenceId }, relations: ['event'] });
    if (!occurrence) {
      throw new NotFoundException('Event occurrence not found');
    }
    if (occurrence.event.archived_at) {
      throw new BadRequestException('Event is archived');
    }

    await this.getParticipantOrThrow(occurrence.event_id, userId);

    const now = new Date();
    if (now < occurrence.start_at || now > occurrence.end_at) {
      throw new BadRequestException('Event occurrence can only be activated while ongoing');
    }

    await this.userRepository.update({ id: userId }, { active_event_occurrence_id: occurrenceId });
    return { activeEventOccurrenceId: occurrenceId };
  }

  async deactivateOccurrence(userId: string): Promise<void> {
    await this.userRepository.update({ id: userId }, { active_event_occurrence_id: null });
  }

  async promoteParticipant(eventId: string, targetUserId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const event = await this.getEventOrThrow(eventId);
    await this.ensureEventNotArchived(event);
    await this.ensureAdmin(eventId, actorUserId);

    const participant = await this.getParticipant(eventId, targetUserId);
    if (!participant) {
      throw new NotFoundException('Target user is not an event participant');
    }
    if (participant.role === 'admin') {
      return;
    }
    participant.role = 'admin';
    participant.updated_by = actorUserId;
    await this.eventParticipantRepository.save(participant);
  }

  async archiveEvent(eventId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const event = await this.getEventOrThrow(eventId);
    await this.ensureAdmin(eventId, actorUserId);
    if (event.archived_at) {
      return;
    }
    event.archived_at = new Date();
    event.archived_by = actorUserId;
    event.updated_by = actorUserId;
    await this.eventRepository.save(event);

    await this.userRepository.query(
      `
        UPDATE users
        SET active_event_occurrence_id = NULL
        WHERE active_event_occurrence_id IN (
          SELECT id
          FROM event_occurrences
          WHERE event_id = $1
        )
      `,
      [eventId],
    );
  }

  async listMessages(eventId: string, userId: string): Promise<EventMessage[]> {
    await this.ensureRegisteredUser(userId);
    const participant = await this.getParticipant(eventId, userId);
    if (!participant) {
      const isPlatformAdmin = await this.adminService.isAdmin(userId);
      if (!isPlatformAdmin) {
        throw new ForbiddenException('You are not allowed to view event messages');
      }
    }
    return this.eventMessageRepository.find({
      where: { event_id: eventId },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async createMessage(input: CreateEventMessageInput): Promise<EventMessage> {
    await this.ensureRegisteredUser(input.authorUserId);
    const event = await this.getEventOrThrow(input.eventId);
    await this.ensureEventNotArchived(event);
    const participant = await this.getParticipantOrThrow(input.eventId, input.authorUserId);

    const subject = input.subject?.trim();
    const body = input.body?.trim();
    if (!subject) {
      throw new BadRequestException('subject is required');
    }
    if (!body) {
      throw new BadRequestException('body is required');
    }

    if (participant.role !== 'admin' && input.audience !== 'admins') {
      throw new ForbiddenException('Event members can only message event admins');
    }

    const message = this.eventMessageRepository.create({
      event_id: input.eventId,
      author_user_id: input.authorUserId,
      audience: input.audience,
      subject,
      body,
      created_by: input.authorUserId,
      updated_by: input.authorUserId,
    });
    const saved = await this.eventMessageRepository.save(message);
    await this.sendEventMessageEmailFanout(event.name, saved, input.authorUserId);
    return saved;
  }

  private async sendEventMessageEmailFanout(eventName: string, message: EventMessage, authorUserId: string): Promise<void> {
    const recipientRole = message.audience === 'admins' ? 'admin' : 'member';
    const recipients = await this.eventParticipantRepository.find({
      where: { event_id: message.event_id, role: recipientRole },
    });
    const recipientIds = recipients.map((recipient) => recipient.user_id).filter((id) => id !== authorUserId);
    if (recipientIds.length === 0) {
      return;
    }

    const recipientEmails = await this.userEmailRepository.find({
      where: {
        user_id: In(recipientIds),
        is_selected_for_login: true,
      },
    });
    const uniqueEmails = [...new Set(recipientEmails.map((recipientEmail) => recipientEmail.email))];

    await this.emailService.sendCommunityMessage(uniqueEmails, {
      subject: `[Event: ${eventName}] ${message.subject}`,
      preheader: 'New event message in Cleancentive',
      title: eventName,
      body: message.body,
      disclosure: 'Platform admins can read team and event messages for moderation purposes.',
    });
  }

  async resolveActiveOccurrenceForReport(
    userId: string,
    reportLatitude: number,
    reportLongitude: number,
  ): Promise<ActiveOccurrenceResolution> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'active_event_occurrence_id'],
    });

    if (!user?.active_event_occurrence_id) {
      return {
        eventId: null,
        occurrenceId: null,
        warning: null,
      };
    }

    const occurrence = await this.eventOccurrenceRepository.findOne({
      where: { id: user.active_event_occurrence_id },
      relations: ['event'],
    });

    if (!occurrence || occurrence.event.archived_at) {
      await this.userRepository.update({ id: userId }, { active_event_occurrence_id: null });
      return { eventId: null, occurrenceId: null, warning: null };
    }

    const participant = await this.getParticipant(occurrence.event_id, userId);
    if (!participant) {
      await this.userRepository.update({ id: userId }, { active_event_occurrence_id: null });
      return { eventId: null, occurrenceId: null, warning: null };
    }

    const now = new Date();
    if (now < occurrence.start_at || now > occurrence.end_at) {
      await this.userRepository.update({ id: userId }, { active_event_occurrence_id: null });
      return { eventId: null, occurrenceId: null, warning: null };
    }

    const distanceKm = this.distanceKm(reportLatitude, reportLongitude, occurrence.latitude, occurrence.longitude);
    const warning = distanceKm > this.warningThresholdKm
      ? `Your report is ${distanceKm.toFixed(1)}km away from the active event location.`
      : null;

    return {
      eventId: occurrence.event_id,
      occurrenceId: occurrence.id,
      warning,
    };
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
