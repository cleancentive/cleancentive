import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPickSessionAndImageHash1776300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "pick_session_id" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "image_sha256" char(64) NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spots_user_created_at" ON "spots" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spots_user_image_sha256" ON "spots" ("user_id", "image_sha256") WHERE "image_sha256" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spots_pick_session_id" ON "spots" ("pick_session_id") WHERE "pick_session_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_spots_pick_session_id"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_user_image_sha256"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_user_created_at"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "image_sha256"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "pick_session_id"`);
  }
}
