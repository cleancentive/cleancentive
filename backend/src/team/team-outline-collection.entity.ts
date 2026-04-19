import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('team_outline_collections')
@Index('IDX_team_outline_collections_team_id', ['team_id'])
export class TeamOutlineCollection extends BaseEntity {
  @Column('uuid', { unique: true })
  team_id: string;

  @Column('varchar')
  outline_collection_id: string;
}
