import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Event } from './event.entity';

@Entity('event_occurrences')
@Index('IDX_event_occurrences_event_id', ['event_id'])
@Index('IDX_event_occurrences_start_at', ['start_at'])
@Index('IDX_event_occurrences_end_at', ['end_at'])
export class EventOccurrence extends BaseEntity {
  @Column('uuid')
  event_id: string;

  @Column('timestamp')
  start_at: Date;

  @Column('timestamp')
  end_at: Date;

  @Column('double precision')
  latitude: number;

  @Column('double precision')
  longitude: number;

  @Column('varchar', { nullable: true })
  location_name: string | null;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: Event;
}
