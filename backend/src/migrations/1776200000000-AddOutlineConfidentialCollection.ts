import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutlineConfidentialCollection1776200000000 implements MigrationInterface {
  name = 'AddOutlineConfidentialCollection1776200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_outline_collections" ADD COLUMN "outline_confidential_collection_id" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_outline_collections" DROP COLUMN "outline_confidential_collection_id"`,
    );
  }
}
