import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingAuthRequestMetadata1777400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Who asked for this sign-in. Already shown in the magic-link email so the
    // recipient can tell their own attempt from someone else's; now also shown
    // on the device that opens the link, which has to decide whether to hand a
    // session to whoever started the request.
    await queryRunner.query(`ALTER TABLE "pending_auth_requests" ADD COLUMN "browser" varchar NULL`);
    await queryRunner.query(`ALTER TABLE "pending_auth_requests" ADD COLUMN "location" varchar NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pending_auth_requests" DROP COLUMN "location"`);
    await queryRunner.query(`ALTER TABLE "pending_auth_requests" DROP COLUMN "browser"`);
  }
}
