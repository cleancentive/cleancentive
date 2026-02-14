import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { UserEmail } from './user-email.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column('varchar', { unique: true })
  nickname: string;

  @Column('varchar', { nullable: true })
  full_name: string;

  @OneToMany(() => UserEmail, email => email.user)
  emails: UserEmail[];
}