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

  @Column('double precision', { nullable: true })
  weight_grams: number | null;

  @Column('double precision', { nullable: true })
  confidence: number | null;

  @Column('varchar', { nullable: true })
  source_model: string | null;
}
