import { Entity, Column, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

export enum CodeChallengeMethod {
  PLAIN = 'plain',
  S256 = 'S256',
}

@Entity()
@Index(['expiresAt'])
export class OidcAuthorizationCode {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'code' })
  code: string;

  @Column({ name: 'code_challenge', nullable: true })
  codeChallenge: string;

  @Column({ type: 'varchar', name: 'code_challenge_method', nullable: true })
  codeChallengeMethod: CodeChallengeMethod | null;

  @Column({ name: 'redirect_uri' })
  redirectUri: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column()
  scope: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  nonce: string;

  @Column()
  @Index()
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('oidc_refresh_token')
@Index(['userId'])
@Index(['expiresAt'])
export class OidcRefreshToken {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'token_hash' })
  tokenHash: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column()
  scope: string;

  @Column()
  @Index()
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('oidc_client')
export class OidcClient {
  @PrimaryColumn({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'client_secret' })
  clientSecret: string;

  @Column('text', { array: true, name: 'redirect_uris' })
  redirectUris: string[];

  @Column({ default: true })
  enabled: boolean;
}
