import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('events')
@Index('UQ_events_name_normalized', ['name_normalized'], { unique: true })
@Index('IDX_events_archived_at', ['archived_at'])
export class Event extends BaseEntity {
  @Column('varchar')
  name: string;

  @Column('varchar')
  name_normalized: string;

  @Column('text')
  description: string;

  @Column('timestamp', { nullable: true })
  archived_at: Date | null;

  @Column('uuid', { nullable: true })
  archived_by: string | null;
}
