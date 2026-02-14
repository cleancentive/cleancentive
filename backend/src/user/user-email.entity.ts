import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { User } from './user.entity';

@Entity('user_emails')
@Unique(['email'])
export class UserEmail extends BaseEntity {
  @Column('varchar')
  email: string;

  @Column({ default: false })
  is_selected_for_login: boolean;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column('uuid')
  user_id: string;
}