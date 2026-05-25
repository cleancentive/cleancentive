import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSpotEdits1776800000000 implements MigrationInterface {
  name = 'CreateSpotEdits1776800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "spot_edits" (
        "id" uuid NOT NULL,
        "spot_id" uuid,
        "field_changed" varchar NOT NULL,
        "old_value" varchar,
        "new_value" varchar,
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_spot_edits" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_spot_edits_spot_id" ON "spot_edits" ("spot_id")`);
    await queryRunner.query(
      `ALTER TABLE "spot_edits" ADD CONSTRAINT "FK_spot_edits_spot_id" FOREIGN KEY ("spot_id") REFERENCES "spots"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "spot_edits" ADD CONSTRAINT "FK_spot_edits_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "spot_edits" DROP CONSTRAINT "FK_spot_edits_created_by"`);
    await queryRunner.query(`ALTER TABLE "spot_edits" DROP CONSTRAINT "FK_spot_edits_spot_id"`);
    await queryRunner.query(`DROP INDEX "IDX_spot_edits_spot_id"`);
    await queryRunner.query(`DROP TABLE "spot_edits"`);
  }
}
