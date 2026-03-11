import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('teams')
@Index('UQ_teams_name_normalized', ['name_normalized'], { unique: true })
@Index('IDX_teams_archived_at', ['archived_at'])
export class Team extends BaseEntity {
  @Column('varchar')
  name: string;

  @Column('varchar')
  name_normalized: string;

  @Column('text')
  description: string;

  @Column('timestamp', { nullable: true })
  archived_at: Date | null;

  @Column('uuid', { nullable: true })
  archived_by: string | null;
}
