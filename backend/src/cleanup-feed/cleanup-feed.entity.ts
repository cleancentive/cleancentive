import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import type { Locale } from '@cleancentive/shared';
import { BaseEntity } from '../common/base.entity';
import { Team } from '../team/team.entity';

/** The adapters that know how to read a source. One per external site. */
export type CleanupFeedKind = 'cleanuptour';

export interface CleanupFeedSettings {
  /** Which language of the source to mirror. Falls back to the source's own default. */
  language: Locale;
  /** Only 'upcoming' today: past events on the source are not backfilled. */
  horizon: 'upcoming';
  /** Put in front of every imported name, e.g. "Clean-Up Tour" + "Zermatt". */
  namePrefix: string;
}

export const DEFAULT_FEED_SETTINGS: CleanupFeedSettings = {
  language: 'de',
  horizon: 'upcoming',
  namePrefix: '',
};

export interface CleanupFeedRunSummary {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  listed: number;
  fetched: number;
  skippedPast: number;
  created: number;
  adopted: number;
  updated: number;
  archived: number;
  unchanged: number;
  items: {
    created: Array<{ cleanupId: string; name: string; startAt: string; url: string }>;
    adopted: Array<{ cleanupId: string; name: string }>;
    updated: Array<{ cleanupId: string; name: string; fields: string[] }>;
    archived: Array<{ cleanupId: string; name: string }>;
  };
  errors: Array<{ externalId: string; title: string; url: string; reason: string }>;
}

@Entity('cleanup_feeds')
@Index('IDX_cleanup_feeds_team_id', ['team_id'])
@Index('UQ_cleanup_feeds_team_url', ['team_id', 'url'], { unique: true })
export class CleanupFeed extends BaseEntity {
  @Column('uuid')
  team_id: string;

  @Column('varchar', { length: 40 })
  kind: CleanupFeedKind;

  @Column('varchar', { length: 2048 })
  url: string;

  @Column('jsonb')
  settings: CleanupFeedSettings;

  @Column('boolean', { default: true })
  enabled: boolean;

  @Column('timestamp with time zone', { nullable: true })
  last_run_at: Date | null;

  @Column('timestamp with time zone', { nullable: true })
  last_success_at: Date | null;

  @Column('text', { nullable: true })
  last_error: string | null;

  @Column('jsonb', { nullable: true })
  last_summary: CleanupFeedRunSummary | null;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;
}
