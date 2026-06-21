import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';

interface SeedEntry {
  type: string;
  translations: Record<string, string>;
}

interface NeophyteEntry {
  scientific_name: string;
  common_name_en: string;
}

// Resolve the seed file relative to the source tree (process.cwd() is the backend root
// in both dev and prod; __dirname points to dist/ in prod where the JSON isn't copied)
const SEED_FILE = join(process.cwd(), 'src', 'label', 'seed', 'labels.json');
const NEOPHYTE_SEED_FILE = join(
  process.cwd(), '..', 'shared', 'src', 'infoflora', 'neophytes.json',
);

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

        if (existing.length > 0) {
          // Label already seeded — backfill any translations added to the seed
          // file since (e.g. new `fr` entries) without touching existing rows.
          const labelId = existing[0].id;
          for (const [locale, name] of Object.entries(entry.translations)) {
            const hasLocale = await queryRunner.query(
              `SELECT 1 FROM label_translations WHERE label_id = $1 AND locale = $2`,
              [labelId, locale],
            );
            if (hasLocale.length === 0) {
              await queryRunner.query(
                `INSERT INTO label_translations (id, label_id, locale, name) VALUES ($1, $2, $3, $4)`,
                [uuidv7(), labelId, locale, name],
              );
            }
          }
          continue;
        }

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

      const neophytes: NeophyteEntry[] = JSON.parse(readFileSync(NEOPHYTE_SEED_FILE, 'utf-8'));
      let speciesSeeded = 0;
      for (const entry of neophytes) {
        const existing = await queryRunner.query(
          `SELECT id FROM labels WHERE type = 'object' AND LOWER(scientific_name) = LOWER($1)`,
          [entry.scientific_name],
        );
        if (existing.length > 0) continue;

        const labelId = uuidv7();
        await queryRunner.query(
          `INSERT INTO labels (id, type, scientific_name) VALUES ($1, 'object', $2)`,
          [labelId, entry.scientific_name],
        );
        await queryRunner.query(
          `INSERT INTO label_translations (id, label_id, locale, name) VALUES ($1, $2, 'en', $3)`,
          [uuidv7(), labelId, entry.common_name_en],
        );
        speciesSeeded++;
      }

      await queryRunner.commitTransaction();
      if (seeded > 0) {
        this.logger.log(`Seeded ${seeded} new labels`);
      }
      if (speciesSeeded > 0) {
        this.logger.log(`Seeded ${speciesSeeded} new plant species labels from InfoFlora`);
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
