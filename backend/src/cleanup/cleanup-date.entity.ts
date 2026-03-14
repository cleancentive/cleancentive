import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { Cleanup } from './cleanup.entity';

@Entity('cleanup_dates')
@Index('IDX_cleanup_dates_cleanup_id', ['cleanup_id'])
@Index('IDX_cleanup_dates_start_at', ['start_at'])
@Index('IDX_cleanup_dates_end_at', ['end_at'])
export class CleanupDate extends BaseEntity {
  @Column('uuid')
  cleanup_id: string;

  @Column('timestamp')
  start_at: Date;

  @Column('timestamp')
  end_at: Date;

  @Column('double precision')
  latitude: number;

  @Column('double precision')
  longitude: number;

  @Column('varchar', { nullable: true })
  location_name: string | null;

  @ManyToOne(() => Cleanup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cleanup_id' })
  cleanup: Cleanup;
}
