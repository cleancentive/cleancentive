import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserLocale1777000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable: NULL means "never chosen — auto-detect from the browser".
    // A stored value is an explicit, cross-device user preference.
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "locale" VARCHAR(5) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "locale"`);
  }
}
