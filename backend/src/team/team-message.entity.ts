import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Team } from './team.entity';
import { User } from '../user/user.entity';

@Entity('team_messages')
@Index('IDX_team_messages_team_id', ['team_id'])
@Index('IDX_team_messages_created_at', ['created_at'])
export class TeamMessage extends BaseEntity {
  @Column('uuid')
  team_id: string;

  @Column('uuid')
  author_user_id: string;

  @Column('varchar')
  audience: 'members' | 'admins';

  @Column('varchar')
  subject: string;

  @Column('text')
  body: string;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_user_id' })
  author: User;
}
