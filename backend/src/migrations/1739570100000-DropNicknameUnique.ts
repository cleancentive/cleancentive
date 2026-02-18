import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropNicknameUnique1739570100000 implements MigrationInterface {
  name = 'DropNicknameUnique1739570100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_4300ee8b2b8c5b1b9f3b02e7e7"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_4300ee8b2b8c5b1b9f3b02e7e7" ON "users" ("nickname")
    `);
  }
}
