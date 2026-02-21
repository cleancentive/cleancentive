import { Entity, PrimaryColumn, Column } from 'typeorm';

export enum PendingAuthStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

@Entity('pending_auth_requests')
export class PendingAuthRequest {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ nullable: true, type: 'text' })
  sessionToken: string | null;

  @Column({
    type: 'enum',
    enum: PendingAuthStatus,
    default: PendingAuthStatus.PENDING,
  })
  status: PendingAuthStatus;

  @Column()
  expiresAt: Date;
}
