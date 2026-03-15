import { Entity, Column, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { User } from '../user/user.entity';
import { FeedbackResponse } from './feedback-response.entity';

@Entity('feedback')
@Index('IDX_feedback_user_id', ['user_id'])
@Index('IDX_feedback_status', ['status'])
@Index('IDX_feedback_guest_id', ['guest_id'])
export class Feedback extends BaseEntity {
  @Column('varchar')
  category: 'bug' | 'suggestion' | 'question';

  @Column('text')
  description: string;

  @Column('varchar', { default: 'new' })
  status: 'new' | 'acknowledged' | 'in_progress' | 'resolved';

  @Column('varchar', { nullable: true })
  contact_email: string | null;

  @Column('uuid', { nullable: true })
  user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column('uuid', { nullable: true })
  guest_id: string | null;

  @Column('jsonb', { nullable: true })
  error_context: { url?: string; message?: string; userAgent?: string; stack?: string } | null;

  @OneToMany(() => FeedbackResponse, (r) => r.feedback)
  responses: FeedbackResponse[];
}
