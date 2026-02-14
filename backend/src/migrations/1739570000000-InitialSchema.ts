import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1739570000000 implements MigrationInterface {
  name = 'InitialSchema1739570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "nickname" varchar NOT NULL,
        "full_name" varchar,
        CONSTRAINT "PK_96aac72f1574b88752e9fb00089" PRIMARY KEY ("id")
      )
    `);

    // Create unique index on nickname
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_4300ee8b2b8c5b1b9f3b02e7e7" ON "users" ("nickname")
    `);

    // Create user_emails table
    await queryRunner.query(`
      CREATE TABLE "user_emails" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "email" varchar NOT NULL,
        "is_selected_for_login" boolean NOT NULL DEFAULT false,
        "user_id" uuid NOT NULL,
        CONSTRAINT "PK_1e3fbac1c2f88e5b6e1b6c6e1e" PRIMARY KEY ("id")
      )
    `);

    // Create unique index on email
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_1e3fbac1c2f88e5b6e1b6c6e1e" ON "user_emails" ("email")
    `);

    // Create foreign key
    await queryRunner.query(`
      ALTER TABLE "user_emails"
      ADD CONSTRAINT "FK_1e3fbac1c2f88e5b6e1b6c6e1e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_emails" DROP CONSTRAINT "FK_1e3fbac1c2f88e5b6e1b6c6e1e"`);
    await queryRunner.query(`DROP INDEX "IDX_1e3fbac1c2f88e5b6e1b6c6e1e"`);
    await queryRunner.query(`DROP TABLE "user_emails"`);
    await queryRunner.query(`DROP INDEX "IDX_4300ee8b2b8c5b1b9f3b02e7e7"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}