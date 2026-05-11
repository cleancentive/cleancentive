import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeSpotLocationAccuracyNullable1776400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "spots" ALTER COLUMN "location_accuracy_meters" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "spots" ALTER COLUMN "location_accuracy_meters" SET NOT NULL`,
    );
  }
}
