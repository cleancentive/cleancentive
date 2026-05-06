import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('teams')
@Index('UQ_teams_name_normalized', ['name_normalized'], { unique: true })
@Index('IDX_teams_archived_at', ['archived_at'])
@Index('UQ_teams_system_key', ['system_key'], { unique: true, where: 'system_key IS NOT NULL' })
export class Team extends BaseEntity {
  @Column('varchar')
  name: string;

  @Column('varchar')
  name_normalized: string;

  @Column('text')
  description: string;

  @Column('varchar', { nullable: true })
  system_key: string | null;

  @Column('timestamp', { nullable: true })
  archived_at: Date | null;

  @Column('uuid', { nullable: true })
  archived_by: string | null;

  @Column('text', { nullable: true })
  custom_css: string | null;
}
