import { Entity, Column, ManyToOne, JoinColumn, CreateDateColumn, PrimaryColumn, BeforeInsert, Index } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

export const API_KEY_SCOPES = ['read', 'write:spots'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * A credential for an application, never for a person. It says which client
 * is calling, so its picks can be attributed and its traffic budgeted; the
 * person behind a request still authenticates with their own bearer token.
 */
@Entity('api_keys')
export class ApiKey {
  @PrimaryColumn('uuid')
  id: string;

  @Column('varchar', { length: 100 })
  name: string;

  @Column('varchar', { length: 16 })
  key_prefix: string;

  @Index('IDX_api_keys_key_hash', { unique: true })
  @Column('char', { length: 64 })
  key_hash: string;

  @Column('text', { array: true, default: '{}' })
  scopes: ApiKeyScope[];

  @Column('integer', { default: 60 })
  rate_limit_per_minute: number;

  /** The steward who issued the key. */
  @Column('uuid', { nullable: true })
  owner_user_id: string | null;

  @ManyToOne('User', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_user_id' })
  owner: any;

  @Column('varchar', { length: 255 })
  contact_email: string;

  @Column('timestamp with time zone', { nullable: true })
  last_used_at: Date | null;

  @Column('timestamp with time zone', { nullable: true })
  expires_at: Date | null;

  @Column('timestamp with time zone', { nullable: true })
  revoked_at: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv7();
    }
  }
}
