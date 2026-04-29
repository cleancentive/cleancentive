import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('outline_webhook_config')
export class OutlineWebhookConfig extends BaseEntity {
  @Column('varchar')
  secret: string;
}
