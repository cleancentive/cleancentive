import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleanupDateRecurrenceId1769000000000 implements MigrationInterface {
  name = 'AddCleanupDateRecurrenceId1769000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cleanup_dates" ADD "recurrence_id" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cleanup_dates" DROP COLUMN "recurrence_id"`);
  }
}
