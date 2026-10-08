import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPersonalAccessTokens1777600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Personal access tokens: a bearer credential a person creates for their
    // own scripts and third-party clients. Until now the only way to call the
    // API from outside the app was to lift a year-long session token out of the
    // browser, which could not be revoked on its own. Only the SHA-256 of the
    // token is stored; the prefix is what the owner sees in the list.
    await queryRunner.query(`
      CREATE TABLE "personal_access_tokens" (
        "id" uuid PRIMARY KEY,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(100) NOT NULL,
        "token_prefix" varchar(16) NOT NULL,
        "token_hash" char(64) NOT NULL,
        "last_used_at" TIMESTAMP WITH TIME ZONE NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_personal_access_tokens_token_hash" ON "personal_access_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_personal_access_tokens_user_id" ON "personal_access_tokens" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "personal_access_tokens"`);
  }
}
