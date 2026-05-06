import { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanupDatesTimestamptz1776000000000 implements MigrationInterface {
  name = 'CleanupDatesTimestamptz1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cleanup_dates" ALTER COLUMN "start_at" TYPE timestamptz USING "start_at" AT TIME ZONE 'UTC'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleanup_dates" ALTER COLUMN "end_at" TYPE timestamptz USING "end_at" AT TIME ZONE 'UTC'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cleanup_dates" ALTER COLUMN "end_at" TYPE timestamp USING "end_at" AT TIME ZONE 'UTC'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleanup_dates" ALTER COLUMN "start_at" TYPE timestamp USING "start_at" AT TIME ZONE 'UTC'`,
    );
  }
}
