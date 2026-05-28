import { MigrationInterface, QueryRunner } from 'typeorm';

// Folds plant identifications into the unified DetectedItem model:
//   - spots.subject_kind dispatches worker (plantnet vs vision LLM) and filters map/insights.
//   - labels.scientific_name marks species labels (NULL for litter object/material/brand).
//   - Seeds the "Plant matter" material so the worker has a stable FK target.
//
// If you previously ran the predecessor migration AddSubjectKindAndPlantIdentifications,
// drop its artefacts locally first:
//   DROP TABLE plant_identifications CASCADE;
//   ALTER TABLE spots DROP COLUMN IF EXISTS subject_kind;
//   DELETE FROM migrations WHERE name LIKE 'AddSubjectKindAndPlantIdentifications%';

export class AddSubjectKindAndSpeciesLabels1776900000000 implements MigrationInterface {
  name = 'AddSubjectKindAndSpeciesLabels1776900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "subject_kind" varchar(16) NOT NULL DEFAULT 'litter'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spots_subject_kind" ON "spots" ("subject_kind")`,
    );

    await queryRunner.query(
      `ALTER TABLE "labels" ADD COLUMN "scientific_name" varchar`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_labels_type_scientific_name"
       ON "labels" ("type", "scientific_name")
       WHERE "scientific_name" IS NOT NULL`,
    );

    // Seed the "Plant matter" material label idempotently so the worker can FK to it.
    await queryRunner.query(`
      WITH new_label AS (
        INSERT INTO labels (id, type, created_at, updated_at)
        SELECT uuid_generate_v4(), 'material', NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM labels l
          JOIN label_translations lt ON lt.label_id = l.id
          WHERE l.type = 'material' AND lt.locale = 'en' AND LOWER(lt.name) = 'plant matter'
        )
        RETURNING id
      )
      INSERT INTO label_translations (id, label_id, locale, name, created_at, updated_at)
      SELECT uuid_generate_v4(), id, 'en', 'Plant matter', NOW(), NOW()
      FROM new_label
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_labels_type_scientific_name"`);
    await queryRunner.query(`ALTER TABLE "labels" DROP COLUMN "scientific_name"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_subject_kind"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "subject_kind"`);
  }
}
