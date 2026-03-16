import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('label_translations')
@Unique('UQ_label_translations_label_locale', ['label_id', 'locale'])
export class LabelTranslation extends BaseEntity {
  @Column('uuid')
  label_id: string;

  @ManyToOne('Label', (label: any) => label.translations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'label_id' })
  label: any;

  @Column('varchar', { length: 10 })
  locale: string;

  @Column('varchar')
  name: string;
}
