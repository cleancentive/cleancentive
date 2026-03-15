import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Team } from './team.entity';
import { User } from '../user/user.entity';

@Entity('team_memberships')
@Index('UQ_team_memberships_team_user', ['team_id', 'user_id'], { unique: true })
@Index('IDX_team_memberships_team_id', ['team_id'])
@Index('IDX_team_memberships_user_id', ['user_id'])
export class TeamMembership extends BaseEntity {
  @Column('uuid')
  team_id: string;

  @Column('uuid')
  user_id: string;

  @Column('varchar', { default: 'member' })
  role: 'member' | 'organizer';

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
