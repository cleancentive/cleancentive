import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpotDetectionReview1777100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Review is tracked on the spot, not only on its detected items, because a
    // spot where the model found nothing still needs confirming — and "the model
    // correctly found nothing" is signal we otherwise cannot record.
    await queryRunner.query(`ALTER TABLE "spots" ADD COLUMN "detection_reviewed_at" TIMESTAMP NULL`);
    await queryRunner.query(`ALTER TABLE "spots" ADD COLUMN "detection_reviewed_by" uuid NULL`);

    // The review queue asks for the oldest unreviewed completed spots on every
    // load, so index exactly that.
    await queryRunner.query(
      `CREATE INDEX "idx_spots_detection_review_queue" ON "spots" ("created_at")
       WHERE "detection_reviewed_at" IS NULL AND "processing_status" = 'completed'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_spots_detection_review_queue"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "detection_reviewed_by"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "detection_reviewed_at"`);
  }
}
