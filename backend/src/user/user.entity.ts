import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column('varchar')
  nickname: string;

  @Column('varchar', { nullable: true })
  full_name: string;

  @Column('timestamp', { nullable: true })
  last_login: Date;

  @Column('uuid', { nullable: true })
  active_team_id: string | null;

  @Column('uuid', { nullable: true })
  active_cleanup_date_id: string | null;

  @Column('uuid', { nullable: true })
  avatar_email_id: string | null;

  @Column('varchar', { nullable: true })
  uploaded_avatar_key: string | null;

  @Column('timestamp with time zone', { nullable: true })
  uploaded_avatar_updated_at: Date | null;

  @Column('timestamp with time zone', { nullable: true })
  calendar_feed_last_fetched_at: Date | null;

  /**
   * When a guest session token was issued for this id. Set once, so a guest id
   * that leaks cannot be exchanged for a token by whoever finds it.
   */
  @Column('timestamp with time zone', { nullable: true })
  guest_token_issued_at: Date | null;

  // Preferred UI/email language. NULL = auto-detect from the browser.
  // One of @cleancentive/shared SUPPORTED_LOCALES ('en' | 'de' | 'fr').
  @Column('varchar', { length: 5, nullable: true })
  locale: string | null;

  @OneToMany('UserEmail', (email: any) => email.user)
  emails: any[];
}
