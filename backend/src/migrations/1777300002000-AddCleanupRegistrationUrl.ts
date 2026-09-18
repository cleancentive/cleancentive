import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleanupRegistrationUrl1777300002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Where signing up actually happens, when that is not here: a mirrored
    // cleanup's organizer usually runs their own form. Kept as a column rather
    // than a line in the description, so editing the text cannot lose it.
    await queryRunner.query(`ALTER TABLE "cleanups" ADD "registration_url" varchar(2048) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cleanups" DROP COLUMN "registration_url"`);
  }
}
