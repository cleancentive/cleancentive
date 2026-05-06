import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('outline_maintenance_state')
@Index('UQ_outline_maintenance_state_key', ['key'], { unique: true })
export class OutlineMaintenanceState extends BaseEntity {
  @Column('varchar')
  key: string;

  @Column('timestamp')
  completed_at: Date;
}
