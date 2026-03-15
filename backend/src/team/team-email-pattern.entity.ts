import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Team } from './team.entity';

@Entity('team_email_patterns')
@Index('IDX_team_email_patterns_team_id', ['team_id'])
export class TeamEmailPattern extends BaseEntity {
  @Column('uuid')
  team_id: string;

  @Column('varchar')
  email_pattern: string;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;
}
