import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCleanupReportTables1760000000000 implements MigrationInterface {
  name = 'CreateCleanupReportTables1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cleanup_reports" (
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
        "analysis_started_at" TIMESTAMP,
        "analysis_completed_at" TIMESTAMP,
        "processing_error" text,
        "analysis_raw" jsonb,
        CONSTRAINT "PK_cleanup_reports_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cleanup_reports_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cleanup_reports_upload_id" ON "cleanup_reports" ("upload_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_reports_user_id" ON "cleanup_reports" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_reports_processing_status" ON "cleanup_reports" ("processing_status")`);

    await queryRunner.query(`
      CREATE TABLE "litter_items" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "report_id" uuid NOT NULL,
        "category" varchar,
        "material" varchar,
        "brand" varchar,
        "weight_grams" double precision,
        "confidence" double precision,
        "source_model" varchar,
        CONSTRAINT "PK_litter_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_litter_items_report_id" FOREIGN KEY ("report_id") REFERENCES "cleanup_reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_litter_items_report_id" ON "litter_items" ("report_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_litter_items_report_id"`);
    await queryRunner.query(`DROP TABLE "litter_items"`);

    await queryRunner.query(`DROP INDEX "IDX_cleanup_reports_processing_status"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_reports_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_reports_upload_id"`);
    await queryRunner.query(`DROP TABLE "cleanup_reports"`);
  }
}
