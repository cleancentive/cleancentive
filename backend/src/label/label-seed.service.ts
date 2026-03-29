import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';

interface SeedEntry {
  type: string;
  translations: Record<string, string>;
}

// Resolve the seed file relative to the source tree (process.cwd() is the backend root
// in both dev and prod; __dirname points to dist/ in prod where the JSON isn't copied)
const SEED_FILE = join(process.cwd(), 'src', 'label', 'seed', 'labels.json');

@Injectable()
export class LabelSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LabelSeedService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const labels: SeedEntry[] = JSON.parse(
      readFileSync(SEED_FILE, 'utf-8'),
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.startTransaction();
    let seeded = 0;

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

        seeded++;
      }

      await queryRunner.commitTransaction();
      if (seeded > 0) {
        this.logger.log(`Seeded ${seeded} new labels`);
      }
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Label seeding failed', err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
