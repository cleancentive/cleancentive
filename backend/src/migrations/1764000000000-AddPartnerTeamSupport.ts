import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPartnerTeamSupport1764000000000 implements MigrationInterface {
  name = 'AddPartnerTeamSupport1764000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "team_email_patterns" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "team_id" uuid NOT NULL,
        "email_pattern" varchar NOT NULL,
        CONSTRAINT "PK_team_email_patterns_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_team_email_patterns_team_id" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_team_email_patterns_team_id" ON "team_email_patterns" ("team_id")`);

    await queryRunner.query(`ALTER TABLE "teams" ADD COLUMN "custom_css" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "teams" DROP COLUMN "custom_css"`);
    await queryRunner.query(`DROP INDEX "IDX_team_email_patterns_team_id"`);
    await queryRunner.query(`DROP TABLE "team_email_patterns"`);
  }
}
