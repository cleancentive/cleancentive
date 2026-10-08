import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Observable, Subject, filter } from 'rxjs';
import { SPOT_EVENTS_CHANNEL, type SpotEvent } from '@cleancentive/shared';
import { redisConnection } from '../common/redis-connection';
import { clearInsightsCache } from './insights-cache';

export interface SpotEventFilter {
  teamId?: string;
  cleanupId?: string;
  cleanupDateId?: string;
}

/** AND of the filters given; a cleanup date narrows further than its cleanup, as on the map. */
export function matchesSpotEventFilter(event: SpotEvent, criteria: SpotEventFilter): boolean {
  if (criteria.teamId && event.teamId !== criteria.teamId) return false;
  if (criteria.cleanupDateId) return event.cleanupDateId === criteria.cleanupDateId;
  if (criteria.cleanupId && event.cleanupId !== criteria.cleanupId) return false;
  return true;
}

/**
 * Spot events in and out of this process.
 *
 * The worker persists detection results with raw SQL, which the TypeORM
 * cache subscriber never sees, so the subscription here is what keeps the
 * insights cache honest about completed detections. That part is always on.
 * Fanning the events out to SSE clients is the part behind
 * INSIGHTS_EVENTS_ENABLED: an experiment for live scoreboards that can be
 * switched off without bringing the staleness back.
 *
 * Backend-originated events go through Redis too rather than straight into
 * the subject, so a second API replica would see them as well.
 */
@Injectable()
export class InsightsEventsService implements OnModuleInit, OnModuleDestroy {
  readonly enabled = process.env.INSIGHTS_EVENTS_ENABLED !== 'false';
  private readonly logger = new Logger(InsightsEventsService.name);
  private readonly publisher = new Redis(redisConnection());
  // A connection in subscriber mode accepts no other commands, so it is its own.
  private readonly subscriber = new Redis(redisConnection());
  private readonly events = new Subject<SpotEvent>();

  async onModuleInit(): Promise<void> {
    await this.subscriber.subscribe(SPOT_EVENTS_CHANNEL);
    this.subscriber.on('message', (_channel: string, raw: string) => void this.onMessage(raw));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.subscriber.quit(), this.publisher.quit()]);
  }

  async publish(event: Omit<SpotEvent, 'emittedAt'>): Promise<void> {
    const payload: SpotEvent = { ...event, emittedAt: new Date().toISOString() };
    await this.publisher.publish(SPOT_EVENTS_CHANNEL, JSON.stringify(payload));
  }

  stream(criteria: SpotEventFilter): Observable<SpotEvent> {
    return this.events.pipe(filter((event) => matchesSpotEventFilter(event, criteria)));
  }

  private async onMessage(raw: string): Promise<void> {
    let event: SpotEvent;
    try {
      event = JSON.parse(raw) as SpotEvent;
    } catch {
      this.logger.warn(`Ignoring malformed spot event: ${raw.slice(0, 200)}`);
      return;
    }
    await clearInsightsCache(this.publisher);
    if (this.enabled) this.events.next(event);
  }
}
