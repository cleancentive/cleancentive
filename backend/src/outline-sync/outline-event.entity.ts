import { Entity, Column, PrimaryColumn, BeforeInsert, CreateDateColumn, Index } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

@Entity('outline_events')
@Index('IDX_outline_events_received_at', ['received_at'])
@Index('IDX_outline_events_event_type', ['event_type'])
export class OutlineEvent {
  @PrimaryColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'received_at' })
  received_at: Date;

  @Column('varchar')
  event_type: string;

  @Column('uuid', { nullable: true })
  actor_id: string | null;

  @Column('uuid', { nullable: true })
  document_id: string | null;

  @Column('uuid', { nullable: true })
  collection_id: string | null;

  @Column('jsonb')
  payload: Record<string, unknown>;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = uuidv7();
  }
}
