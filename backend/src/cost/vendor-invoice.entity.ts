import { Entity, Column, PrimaryColumn, BeforeInsert, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

export type ParseStatus = 'parsed' | 'failed' | 'corrected';

@Entity('vendor_invoices')
@Index('idx_vendor_invoices_attachment', ['attachment_id'], { unique: true })
export class VendorInvoice {
  @PrimaryColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;

  /** The Outline attachment this was read from. Parsing is keyed on it, once ever. */
  @Column('uuid')
  attachment_id: string;

  @Column('uuid', { nullable: true })
  outline_document_id: string | null;

  @Column('varchar')
  file_name: string;

  @Column('varchar')
  vendor: string;

  @Column('date', { nullable: true })
  invoice_date: string | null;

  @Column('date', { nullable: true })
  period_start: string | null;

  @Column('date', { nullable: true })
  period_end: string | null;

  @Column('varchar', { length: 3, nullable: true })
  currency: string | null;

  @Column('numeric', { precision: 12, scale: 2, nullable: true })
  amount_gross: string | null;

  @Column('numeric', { precision: 12, scale: 2, nullable: true })
  amount_chf: string | null;

  @Column('numeric', { precision: 12, scale: 6, nullable: true })
  fx_rate: string | null;

  @Column('varchar', { length: 20 })
  parse_status: ParseStatus;

  /** The raw OCR annotation, so a wrong number is always traceable to its source. */
  @Column('jsonb', { nullable: true })
  parsed_raw: Record<string, unknown> | null;

  @Column('uuid', { nullable: true })
  confirmed_by: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmed_at: Date | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = uuidv7();
  }
}
