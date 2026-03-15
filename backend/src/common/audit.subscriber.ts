import { EventSubscriber, EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm';
import { BaseEntity } from './base.entity';
import { getCurrentUserId } from './request-context';

@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface<BaseEntity> {
  listenTo() {
    return BaseEntity;
  }

  beforeInsert(event: InsertEvent<BaseEntity>): void {
    const userId = getCurrentUserId() ?? null;
    if (event.entity) {
      if (!event.entity.created_by) {
        event.entity.created_by = userId;
      }
      if (!event.entity.updated_by) {
        event.entity.updated_by = userId;
      }
    }
  }

  beforeUpdate(event: UpdateEvent<BaseEntity>): void {
    const userId = getCurrentUserId() ?? null;
    if (event.entity) {
      (event.entity as BaseEntity).updated_by = userId;
    }
  }
}
