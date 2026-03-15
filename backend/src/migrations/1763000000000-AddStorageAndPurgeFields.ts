import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStorageAndPurgeFields1763000000000 implements MigrationInterface {
  name = 'AddStorageAndPurgeFields1763000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "original_size_bytes" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "thumbnail_size_bytes" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "original_purged_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spots_original_purged_at" ON "spots" ("original_purged_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spots_captured_at" ON "spots" ("captured_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_spots_captured_at"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_original_purged_at"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "original_purged_at"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "thumbnail_size_bytes"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "original_size_bytes"`);
  }
}
