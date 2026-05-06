import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreserveDetectedItemEditsOnDelete1775800000000 implements MigrationInterface {
  name = 'PreserveDetectedItemEditsOnDelete1775800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" DROP CONSTRAINT "FK_detected_item_edits_detected_item_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" ALTER COLUMN "detected_item_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" ADD CONSTRAINT "FK_detected_item_edits_detected_item_id" FOREIGN KEY ("detected_item_id") REFERENCES "detected_items"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" DROP CONSTRAINT "FK_detected_item_edits_detected_item_id"`,
    );
    await queryRunner.query(
      `DELETE FROM "detected_item_edits" WHERE "detected_item_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" ALTER COLUMN "detected_item_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" ADD CONSTRAINT "FK_detected_item_edits_detected_item_id" FOREIGN KEY ("detected_item_id") REFERENCES "detected_items"("id") ON DELETE CASCADE`,
    );
  }
}
