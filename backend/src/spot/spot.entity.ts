import { Entity, Column, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { User } from '../user/user.entity';
import { Team } from '../team/team.entity';

@Entity('spots')
@Index('IDX_spots_upload_id', ['upload_id'], { unique: true })
@Index('IDX_spots_user_id', ['user_id'])
@Index('IDX_spots_processing_status', ['processing_status'])
@Index('IDX_spots_team_id', ['team_id'])
@Index('IDX_spots_cleanup_id', ['cleanup_id'])
@Index('IDX_spots_cleanup_date_id', ['cleanup_date_id'])
export class Spot extends BaseEntity {
  @Column('uuid')
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column('uuid', { nullable: true })
  team_id: string | null;

  @ManyToOne(() => Team, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'team_id' })
  team: Team | null;

  @Column('uuid', { nullable: true })
  cleanup_id: string | null;

  @ManyToOne('Cleanup', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'cleanup_id' })
  cleanup: any | null;

  @Column('uuid', { nullable: true })
  cleanup_date_id: string | null;

  @ManyToOne('CleanupDate', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'cleanup_date_id' })
  cleanup_date: any | null;

  @Column('double precision')
  latitude: number;

  @Column('double precision')
  longitude: number;

  @Column('double precision')
  location_accuracy_meters: number;

  @Column('timestamp')
  captured_at: Date;

  @Column('varchar')
  mime_type: string;

  @Column('varchar')
  image_key: string;

  @Column('varchar', { nullable: true })
  thumbnail_key: string | null;

  @Column('varchar')
  upload_id: string;

  @Column('varchar', { default: 'queued' })
  processing_status: 'queued' | 'processing' | 'completed' | 'failed';

  @Column('timestamp', { nullable: true })
  detection_started_at: Date | null;

  @Column('timestamp', { nullable: true })
  detection_completed_at: Date | null;

  @Column('text', { nullable: true })
  processing_error: string | null;

  @Column('jsonb', { nullable: true })
  detection_raw: Record<string, unknown> | null;

  @OneToMany('DetectedItem', (item: any) => item.spot)
  items: any[];
}
