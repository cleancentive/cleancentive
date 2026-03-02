import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('litter_items')
@Index('IDX_litter_items_report_id', ['report_id'])
export class LitterItem extends BaseEntity {
  @Column('uuid')
  report_id: string;

  @ManyToOne('CleanupReport', (report: any) => report.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: any;

  @Column('varchar', { nullable: true })
  category: string | null;

  @Column('varchar', { nullable: true })
  material: string | null;

  @Column('varchar', { nullable: true })
  brand: string | null;

  @Column('double precision', { nullable: true })
  weight_grams: number | null;

  @Column('double precision', { nullable: true })
  confidence: number | null;

  @Column('varchar', { nullable: true })
  source_model: string | null;
}
