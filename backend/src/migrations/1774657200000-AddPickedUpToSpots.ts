import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPickedUpToSpots1774657200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "picked_up" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "picked_up"`);
  }
}
