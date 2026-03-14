import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCleanupReportTables1760000000000 implements MigrationInterface {
  name = 'CreateCleanupReportTables1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "spots" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "user_id" uuid NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "location_accuracy_meters" double precision NOT NULL,
        "captured_at" TIMESTAMP NOT NULL,
        "mime_type" varchar NOT NULL,
        "image_key" varchar NOT NULL,
        "thumbnail_key" varchar,
        "upload_id" varchar NOT NULL,
        "processing_status" varchar NOT NULL DEFAULT 'queued',
        "detection_started_at" TIMESTAMP,
        "detection_completed_at" TIMESTAMP,
        "processing_error" text,
        "detection_raw" jsonb,
        CONSTRAINT "PK_spots_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_spots_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_spots_upload_id" ON "spots" ("upload_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_user_id" ON "spots" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_processing_status" ON "spots" ("processing_status")`);

    await queryRunner.query(`
      CREATE TABLE "detected_items" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "spot_id" uuid NOT NULL,
        "category" varchar,
        "material" varchar,
        "brand" varchar,
        "weight_grams" double precision,
        "confidence" double precision,
        "source_model" varchar,
        CONSTRAINT "PK_detected_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_detected_items_spot_id" FOREIGN KEY ("spot_id") REFERENCES "spots"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_detected_items_spot_id" ON "detected_items" ("spot_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_detected_items_spot_id"`);
    await queryRunner.query(`DROP TABLE "detected_items"`);

    await queryRunner.query(`DROP INDEX "IDX_spots_processing_status"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_upload_id"`);
    await queryRunner.query(`DROP TABLE "spots"`);
  }
}
