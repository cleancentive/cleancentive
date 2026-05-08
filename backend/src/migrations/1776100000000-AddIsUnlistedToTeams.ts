import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsUnlistedToTeams1776100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "teams" ADD COLUMN "is_unlisted" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "teams" DROP COLUMN "is_unlisted"`);
  }
}
