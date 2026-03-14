import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Cleanup } from './cleanup.entity';
import { User } from '../user/user.entity';

@Entity('cleanup_participants')
@Index('UQ_cleanup_participants_cleanup_user', ['cleanup_id', 'user_id'], { unique: true })
@Index('IDX_cleanup_participants_cleanup_id', ['cleanup_id'])
@Index('IDX_cleanup_participants_user_id', ['user_id'])
export class CleanupParticipant extends BaseEntity {
  @Column('uuid')
  cleanup_id: string;

  @Column('uuid')
  user_id: string;

  @Column('varchar', { default: 'member' })
  role: 'member' | 'admin';

  @ManyToOne(() => Cleanup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cleanup_id' })
  cleanup: Cleanup;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
