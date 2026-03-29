import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';

interface SeedEntry {
  type: string;
  translations: Record<string, string>;
}

const labels: SeedEntry[] = JSON.parse(readFileSync(join(__dirname, 'labels.json'), 'utf-8'));

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'cleancentive',
  password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
  database: process.env.DB_DATABASE || 'cleancentive',
});

async function seed() {
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.startTransaction();

  try {
    for (const entry of labels) {
      const enName = entry.translations.en;
      if (!enName) continue;

      const existing = await queryRunner.query(
        `SELECT l.id FROM labels l
         JOIN label_translations lt ON lt.label_id = l.id
         WHERE l.type = $1 AND lt.locale = 'en' AND LOWER(lt.name) = LOWER($2)`,
        [entry.type, enName],
      );

      if (existing.length > 0) continue;

      const labelId = uuidv7();
      await queryRunner.query(
        `INSERT INTO labels (id, type) VALUES ($1, $2)`,
        [labelId, entry.type],
      );

      for (const [locale, name] of Object.entries(entry.translations)) {
        await queryRunner.query(
          `INSERT INTO label_translations (id, label_id, locale, name) VALUES ($1, $2, $3, $4)`,
          [uuidv7(), labelId, locale, name],
        );
      }
    }

    await queryRunner.commitTransaction();
    console.log(`Seeded ${labels.length} labels`);
  } catch (err) {
    await queryRunner.rollbackTransaction();
    throw err;
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
