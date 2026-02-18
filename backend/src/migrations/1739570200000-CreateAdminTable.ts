import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminTable1739570200000 implements MigrationInterface {
  name = 'CreateAdminTable1739570200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admins" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "user_id" uuid NOT NULL,
        CONSTRAINT "PK_admins" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_admins_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_admins_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "admins"`);
  }
}
