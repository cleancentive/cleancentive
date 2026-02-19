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

  @OneToMany('UserEmail', (email: any) => email.user)
  emails: any[];
}