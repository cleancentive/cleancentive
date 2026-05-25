import { Entity, Column, ManyToOne, JoinColumn, CreateDateColumn, PrimaryColumn, BeforeInsert, Index } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

@Entity('spot_edits')
@Index('IDX_spot_edits_spot_id', ['spot_id'])
export class SpotEdit {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  spot_id: string | null;

  @ManyToOne('Spot', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'spot_id' })
  spot: any;

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
