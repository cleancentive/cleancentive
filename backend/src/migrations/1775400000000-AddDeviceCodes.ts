import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeviceCodes1775400000000 implements MigrationInterface {
  name = 'AddDeviceCodes1775400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "device_codes_status_enum" AS ENUM ('pending', 'completed', 'rejected')
    `);

    await queryRunner.query(`
      CREATE TABLE "device_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar NOT NULL,
        "sessionToken" text,
        "status" "device_codes_status_enum" NOT NULL DEFAULT 'pending',
        "expiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_device_codes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_device_codes_code" UNIQUE ("code")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "device_codes"`);
    await queryRunner.query(`DROP TYPE "device_codes_status_enum"`);
  }
}
