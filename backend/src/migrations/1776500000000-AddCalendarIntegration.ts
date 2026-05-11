import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarIntegration1776500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "calendar_feed_last_fetched_at" TIMESTAMP WITH TIME ZONE NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "calendar_email_mode" VARCHAR(8) NOT NULL DEFAULT 'auto'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleanup_participants" ADD COLUMN "email_sequence" INTEGER NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleanup_participants" ADD COLUMN "last_email_sent_at" TIMESTAMP WITH TIME ZONE NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleanup_participants" ADD COLUMN "last_email_method" VARCHAR(8) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cleanup_participants" DROP COLUMN "last_email_method"`);
    await queryRunner.query(`ALTER TABLE "cleanup_participants" DROP COLUMN "last_email_sent_at"`);
    await queryRunner.query(`ALTER TABLE "cleanup_participants" DROP COLUMN "email_sequence"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "calendar_email_mode"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "calendar_feed_last_fetched_at"`);
  }
}
