import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUploadedAvatar1776700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "uploaded_avatar_key" VARCHAR NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "uploaded_avatar_updated_at" TIMESTAMP WITH TIME ZONE NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "uploaded_avatar_updated_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "uploaded_avatar_key"`);
  }
}
