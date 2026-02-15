import { DataSource } from 'typeorm';
import { User } from './src/user/user.entity';
import { UserEmail } from './src/user/user-email.entity';

export const testDataSource = new DataSource({
  type: 'sqlite',
  database: ':memory:',
  entities: [User, UserEmail],
  synchronize: true,
  logging: false,
});