import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('feedback_responses')
@Index('IDX_feedback_responses_feedback_id', ['feedback_id'])
export class FeedbackResponse extends BaseEntity {
  @Column('uuid')
  feedback_id: string;

  @ManyToOne('Feedback', 'responses', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'feedback_id' })
  feedback: any;

  @Column('text')
  message: string;

  @Column('boolean', { default: false })
  is_from_steward: boolean;
}
