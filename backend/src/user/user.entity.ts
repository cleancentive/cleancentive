import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column('varchar', { unique: true })
  nickname: string;

  @Column('varchar', { nullable: true })
  full_name: string;

  @OneToMany('UserEmail', (email: any) => email.user)
  emails: any[];
}