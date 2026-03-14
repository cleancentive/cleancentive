import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('cleanups')
@Index('UQ_cleanups_name_normalized', ['name_normalized'], { unique: true })
@Index('IDX_cleanups_archived_at', ['archived_at'])
export class Cleanup extends BaseEntity {
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
