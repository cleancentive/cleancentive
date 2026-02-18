import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastLoginToUsers1739570300000 implements MigrationInterface {
  name = 'AddLastLoginToUsers1739570300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "last_login" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_login"`);
  }
}
