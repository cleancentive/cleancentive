import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOidcTables1775500000000 implements MigrationInterface {
  name = 'AddOidcTables1775500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "oidc_authorization_code" (
        "id" varchar NOT NULL,
        "code" varchar NOT NULL,
        "code_challenge" varchar,
        "code_challenge_method" varchar,
        "redirect_uri" varchar NOT NULL,
        "client_id" varchar NOT NULL,
        "scope" varchar NOT NULL,
        "user_id" varchar NOT NULL,
        "nonce" varchar NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oidc_authorization_code" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_oidc_auth_code_expires_at" ON "oidc_authorization_code" ("expiresAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "oidc_refresh_token" (
        "id" varchar NOT NULL,
        "token_hash" varchar NOT NULL,
        "user_id" varchar NOT NULL,
        "client_id" varchar NOT NULL,
        "scope" varchar NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oidc_refresh_token" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_oidc_refresh_token_user_id" ON "oidc_refresh_token" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_oidc_refresh_token_expires_at" ON "oidc_refresh_token" ("expiresAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "oidc_client" (
        "client_id" varchar NOT NULL,
        "client_secret" varchar NOT NULL,
        "redirect_uris" text array NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_oidc_client" PRIMARY KEY ("client_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "oidc_client"`);
    await queryRunner.query(`DROP TABLE "oidc_refresh_token"`);
    await queryRunner.query(`DROP TABLE "oidc_authorization_code"`);
  }
}
