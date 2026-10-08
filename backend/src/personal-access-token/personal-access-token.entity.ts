import { Entity, Column, ManyToOne, JoinColumn, CreateDateColumn, PrimaryColumn, BeforeInsert, Index } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

/**
 * A long-lived bearer credential a person creates for their own scripts and
 * third-party clients. It acts as that person, except on the routes that
 * change credentials (see SessionOnlyGuard), and can be revoked on its own
 * without signing the person out anywhere else.
 */
@Entity('personal_access_tokens')
@Index('IDX_personal_access_tokens_user_id', ['user_id'])
export class PersonalAccessToken {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid')
  user_id: string;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: any;

  @Column('varchar', { length: 100 })
  name: string;

  @Column('varchar', { length: 16 })
  token_prefix: string;

  @Index('IDX_personal_access_tokens_token_hash', { unique: true })
  @Column('char', { length: 64 })
  token_hash: string;

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
