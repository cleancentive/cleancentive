import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'cleancentive',
  password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
  database: process.env.DB_DATABASE || 'cleancentive',
  // Every entity, so relations resolve; a hand-kept list went stale and broke
  // the migration CLI on the first entity it did not know.
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
