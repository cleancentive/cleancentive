import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('team_outline_collections')
@Index('IDX_team_outline_collections_team_id', ['team_id'])
export class TeamOutlineCollection extends BaseEntity {
  @Column('uuid', { unique: true })
  team_id: string;

  @Column('varchar')
  outline_collection_id: string;

  @Column('varchar', { nullable: true })
  outline_group_id: string | null;

  @Column('varchar', { nullable: true })
  outline_share_id: string | null;

  @Column('timestamp', { nullable: true })
  initialized_at: Date | null;
}
