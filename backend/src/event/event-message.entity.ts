import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Event } from './event.entity';
import { User } from '../user/user.entity';

@Entity('event_messages')
@Index('IDX_event_messages_event_id', ['event_id'])
@Index('IDX_event_messages_created_at', ['created_at'])
export class EventMessage extends BaseEntity {
  @Column('uuid')
  event_id: string;

  @Column('uuid')
  author_user_id: string;

  @Column('varchar')
  audience: 'members' | 'admins';

  @Column('varchar')
  subject: string;

  @Column('text')
  body: string;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_user_id' })
  author: User;
}
