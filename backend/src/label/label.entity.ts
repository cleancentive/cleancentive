import { Entity, Column, OneToMany, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('labels')
@Index('IDX_labels_type', ['type'])
export class Label extends BaseEntity {
  @Column('varchar')
  type: 'object' | 'material' | 'brand';

  @OneToMany('LabelTranslation', (t: any) => t.label, { eager: true })
  translations: any[];
}
