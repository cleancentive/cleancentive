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

  /**
   * The requesting browser and rough location, captured at issue time. Shown on
   * the device that opens the link when it is not the device that asked, so the
   * person can see whose sign-in they would be completing.
   */
  @Column({ nullable: true, type: 'varchar' })
  browser: string | null;

  @Column({ nullable: true, type: 'varchar' })
  location: string | null;
}
