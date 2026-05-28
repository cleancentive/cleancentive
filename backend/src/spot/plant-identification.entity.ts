import { Entity, Column, OneToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

export type PlantIdentificationSource = 'plantnet' | 'mistral' | 'manual';
export type InvasiveList = 'infoflora_black' | 'infoflora_watch';

@Entity('plant_identifications')
@Index('IDX_plant_identifications_spot_id', ['spot_id'], { unique: true })
@Index('IDX_plant_identifications_scientific_name', ['scientific_name'])
export class PlantIdentification extends BaseEntity {
  @Column('uuid')
  spot_id: string;

  @OneToOne('Spot', (spot: any) => spot.plant_identification, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spot_id' })
  spot: any;

  @Column('varchar')
  scientific_name: string;

  @Column('varchar', { nullable: true })
  common_name_en: string | null;

  @Column('double precision', { nullable: true })
  confidence: number | null;

  @Column('varchar')
  identification_source: PlantIdentificationSource;

  @Column('jsonb', { nullable: true })
  identification_raw: Record<string, unknown> | null;

  @Column('boolean', { default: false })
  is_invasive: boolean;

  @Column('varchar', { nullable: true })
  invasive_list: InvasiveList | null;

  @Column('text', { nullable: true })
  recommended_action: string | null;

  @Column('boolean', { default: false })
  human_verified: boolean;
}
