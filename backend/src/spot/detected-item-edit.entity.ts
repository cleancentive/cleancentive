import { Entity, Column, ManyToOne, JoinColumn, CreateDateColumn, PrimaryColumn, BeforeInsert, Index } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

@Entity('detected_item_edits')
@Index('IDX_detected_item_edits_detected_item_id', ['detected_item_id'])
export class DetectedItemEdit {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid')
  detected_item_id: string;

  @ManyToOne('DetectedItem', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'detected_item_id' })
  detected_item: any;

  @Column('varchar')
  field_changed: string;

  @Column('varchar', { nullable: true })
  old_value: string | null;

  @Column('varchar', { nullable: true })
  new_value: string | null;

  @Column('uuid')
  created_by: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'created_by' })
  user: any;

  @CreateDateColumn()
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv7();
    }
  }
}
