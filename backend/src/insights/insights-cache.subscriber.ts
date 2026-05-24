import Redis from 'ioredis';
import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
  SoftRemoveEvent,
  RecoverEvent,
} from 'typeorm';
import { redisConnection } from '../common/redis-connection';
import { Cleanup } from '../cleanup/cleanup.entity';
import { CleanupDate } from '../cleanup/cleanup-date.entity';
import { CleanupParticipant } from '../cleanup/cleanup-participant.entity';
import { Spot } from '../spot/spot.entity';
import { DetectedItem } from '../spot/detected-item.entity';
import { clearInsightsCache } from './insights-cache';

// Note: TypeORM lifecycle events only fire on save/remove/softRemove/recover.
// Bulk repository.delete() / .update() bypass these hooks; those callsites
// invalidate explicitly via InsightsCacheService.
const WATCHED: ReadonlySet<Function> = new Set([
  Cleanup,
  CleanupDate,
  CleanupParticipant,
  Spot,
  DetectedItem,
]);

@EventSubscriber()
export class InsightsCacheSubscriber implements EntitySubscriberInterface {
  private readonly redis = new Redis(redisConnection());

  private async invalidate(target: unknown): Promise<void> {
    if (typeof target !== 'function' || !WATCHED.has(target as Function)) return;
    await clearInsightsCache(this.redis);
  }

  afterInsert(event: InsertEvent<unknown>) {
    return this.invalidate(event.metadata.target);
  }

  afterUpdate(event: UpdateEvent<unknown>) {
    return this.invalidate(event.metadata.target);
  }

  afterRemove(event: RemoveEvent<unknown>) {
    return this.invalidate(event.metadata.target);
  }

  afterSoftRemove(event: SoftRemoveEvent<unknown>) {
    return this.invalidate(event.metadata.target);
  }

  afterRecover(event: RecoverEvent<unknown>) {
    return this.invalidate(event.metadata.target);
  }
}
