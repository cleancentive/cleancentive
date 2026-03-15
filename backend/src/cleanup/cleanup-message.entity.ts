import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Cleanup } from './cleanup.entity';
import { User } from '../user/user.entity';

@Entity('cleanup_messages')
@Index('IDX_cleanup_messages_cleanup_id', ['cleanup_id'])
@Index('IDX_cleanup_messages_created_at', ['created_at'])
export class CleanupMessage extends BaseEntity {
  @Column('uuid')
  cleanup_id: string;

  @Column('uuid')
  author_user_id: string;

  @Column('varchar')
  audience: 'members' | 'organizers';

  @Column('varchar')
  subject: string;

  @Column('text')
  body: string;

  @ManyToOne(() => Cleanup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cleanup_id' })
  cleanup: Cleanup;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_user_id' })
  author: User;
}
