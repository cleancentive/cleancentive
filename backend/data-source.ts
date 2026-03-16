import { DataSource } from 'typeorm';
import { User } from './src/user/user.entity';
import { UserEmail } from './src/user/user-email.entity';
import { Spot } from './src/spot/spot.entity';
import { DetectedItem } from './src/spot/detected-item.entity';
import { DetectedItemEdit } from './src/spot/detected-item-edit.entity';
import { Label } from './src/label/label.entity';
import { LabelTranslation } from './src/label/label-translation.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'cleancentive',
  password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
  database: process.env.DB_DATABASE || 'cleancentive',
  entities: [User, UserEmail, Spot, DetectedItem, DetectedItemEdit, Label, LabelTranslation],
  migrations: ['src/migrations/*.ts'],
});
