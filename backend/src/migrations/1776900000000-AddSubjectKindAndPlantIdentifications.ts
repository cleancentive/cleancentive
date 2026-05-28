import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubjectKindAndPlantIdentifications1776900000000 implements MigrationInterface {
  name = 'AddSubjectKindAndPlantIdentifications1776900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "subject_kind" varchar(16) NOT NULL DEFAULT 'litter'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spots_subject_kind" ON "spots" ("subject_kind")`,
    );

    await queryRunner.query(`
      CREATE TABLE "plant_identifications" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "spot_id" uuid NOT NULL,
        "scientific_name" varchar NOT NULL,
        "common_name_en" varchar,
        "confidence" double precision,
        "identification_source" varchar NOT NULL,
        "identification_raw" jsonb,
        "is_invasive" boolean NOT NULL DEFAULT false,
        "invasive_list" varchar,
        "recommended_action" text,
        "human_verified" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_plant_identifications" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_plant_identifications_spot_id" ON "plant_identifications" ("spot_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plant_identifications_scientific_name" ON "plant_identifications" ("scientific_name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "plant_identifications" ADD CONSTRAINT "FK_plant_identifications_spot_id" FOREIGN KEY ("spot_id") REFERENCES "spots"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plant_identifications" DROP CONSTRAINT "FK_plant_identifications_spot_id"`);
    await queryRunner.query(`DROP INDEX "IDX_plant_identifications_scientific_name"`);
    await queryRunner.query(`DROP INDEX "IDX_plant_identifications_spot_id"`);
    await queryRunner.query(`DROP TABLE "plant_identifications"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_subject_kind"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "subject_kind"`);
  }
}
