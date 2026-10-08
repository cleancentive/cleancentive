import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApiKeys1777700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // API keys identify an application, not a person: which client created a
    // spot, and how much traffic it may send. The caller still authenticates as
    // a user with their own bearer token. Only the SHA-256 of a key is stored.
    await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id" uuid PRIMARY KEY,
        "name" varchar(100) NOT NULL,
        "key_prefix" varchar(16) NOT NULL,
        "key_hash" char(64) NOT NULL,
        "scopes" text[] NOT NULL DEFAULT '{}',
        "rate_limit_per_minute" integer NOT NULL DEFAULT 60,
        "owner_user_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "contact_email" varchar(255) NOT NULL,
        "last_used_at" TIMESTAMP WITH TIME ZONE NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_api_keys_key_hash" ON "api_keys" ("key_hash")`);
    await queryRunner.query(
      `ALTER TABLE "spots" ADD COLUMN "source_api_key_id" uuid NULL REFERENCES "api_keys"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_spots_source_api_key_id" ON "spots" ("source_api_key_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_spots_source_api_key_id"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "source_api_key_id"`);
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}
