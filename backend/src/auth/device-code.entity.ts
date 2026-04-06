import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum DeviceCodeStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

@Entity('device_codes')
export class DeviceCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column({ nullable: true, type: 'text' })
  sessionToken: string | null;

  @Column({
    type: 'enum',
    enum: DeviceCodeStatus,
    default: DeviceCodeStatus.PENDING,
  })
  status: DeviceCodeStatus;

  @Column()
  expiresAt: Date;
}
