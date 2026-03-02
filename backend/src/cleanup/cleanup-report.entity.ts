import { Entity, Column, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { User } from '../user/user.entity';

@Entity('cleanup_reports')
@Index('IDX_cleanup_reports_upload_id', ['upload_id'], { unique: true })
@Index('IDX_cleanup_reports_user_id', ['user_id'])
@Index('IDX_cleanup_reports_processing_status', ['processing_status'])
export class CleanupReport extends BaseEntity {
  @Column('uuid')
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

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
  analysis_started_at: Date | null;

  @Column('timestamp', { nullable: true })
  analysis_completed_at: Date | null;

  @Column('text', { nullable: true })
  processing_error: string | null;

  @Column('jsonb', { nullable: true })
  analysis_raw: Record<string, unknown> | null;

  @OneToMany('LitterItem', (item: any) => item.report)
  items: any[];
}
