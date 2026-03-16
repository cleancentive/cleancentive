import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('detected_items')
@Index('IDX_detected_items_spot_id', ['spot_id'])
export class DetectedItem extends BaseEntity {
  @Column('uuid')
  spot_id: string;

  @ManyToOne('Spot', (spot: any) => spot.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spot_id' })
  spot: any;

  @Column('varchar', { nullable: true })
  category: string | null;

  @Column('varchar', { nullable: true })
  material: string | null;

  @Column('varchar', { nullable: true })
  brand: string | null;

  @Column('uuid', { nullable: true })
  object_label_id: string | null;

  @ManyToOne('Label', { nullable: true, eager: true })
  @JoinColumn({ name: 'object_label_id' })
  object_label: any;

  @Column('uuid', { nullable: true })
  material_label_id: string | null;

  @ManyToOne('Label', { nullable: true, eager: true })
  @JoinColumn({ name: 'material_label_id' })
  material_label: any;

  @Column('uuid', { nullable: true })
  brand_label_id: string | null;

  @ManyToOne('Label', { nullable: true, eager: true })
  @JoinColumn({ name: 'brand_label_id' })
  brand_label: any;

  @Column('double precision', { nullable: true })
  match_confidence: number | null;

  @Column('boolean', { default: false })
  human_verified: boolean;

  @Column('double precision', { nullable: true })
  weight_grams: number | null;

  @Column('double precision', { nullable: true })
  confidence: number | null;

  @Column('varchar', { nullable: true })
  source_model: string | null;
}
