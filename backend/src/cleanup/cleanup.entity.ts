import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

export interface CleanupSyncSnapshot {
  dateId: string;
  name: string;
  description: string;
  startAt: string;
  endAt: string;
  address: string | null;
  latitude: number;
  longitude: number;
  locationName: string | null;
}

@Entity('cleanups')
@Index('UQ_cleanups_name_normalized', ['name_normalized'], { unique: true })
@Index('IDX_cleanups_archived_at', ['archived_at'])
@Index('IDX_cleanups_team_id', ['team_id'])
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

  @Column('uuid', { nullable: true })
  team_id: string | null;

  @Column('uuid', { nullable: true })
  feed_id: string | null;

  @Column('varchar', { length: 191, nullable: true })
  external_id: string | null;

  @Column('varchar', { length: 2048, nullable: true })
  external_url: string | null;

  /** Opaque change marker from the source; equal means nothing to re-read. */
  @Column('varchar', { length: 64, nullable: true })
  external_version: string | null;

  @Column('timestamp with time zone', { nullable: true })
  synced_at: Date | null;

  /** What the feed last wrote, so human corrections can be told apart. */
  @Column('jsonb', { nullable: true })
  sync_snapshot: CleanupSyncSnapshot | null;
}
