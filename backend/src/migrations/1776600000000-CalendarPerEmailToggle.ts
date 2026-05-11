import { MigrationInterface, QueryRunner } from 'typeorm';

export class CalendarPerEmailToggle1776600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_emails" ADD COLUMN "calendar_emails_enabled" BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "user_emails" ue
         SET "calendar_emails_enabled" = TRUE
       WHERE ue.is_selected_for_login = TRUE
         AND ue.user_id IN (
           SELECT id FROM "users" WHERE calendar_feed_last_fetched_at IS NULL
         )`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "calendar_email_mode"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "calendar_email_mode" VARCHAR(8) NOT NULL DEFAULT 'auto'`,
    );
    await queryRunner.query(`ALTER TABLE "user_emails" DROP COLUMN "calendar_emails_enabled"`);
  }
}
