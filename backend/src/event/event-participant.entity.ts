import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Event } from './event.entity';
import { User } from '../user/user.entity';

@Entity('event_participants')
@Index('UQ_event_participants_event_user', ['event_id', 'user_id'], { unique: true })
@Index('IDX_event_participants_event_id', ['event_id'])
@Index('IDX_event_participants_user_id', ['user_id'])
export class EventParticipant extends BaseEntity {
  @Column('uuid')
  event_id: string;

  @Column('uuid')
  user_id: string;

  @Column('varchar', { default: 'member' })
  role: 'member' | 'admin';

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
