import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSystemTeamsAndOutlineInitState1775900000000 implements MigrationInterface {
  name = 'AddSystemTeamsAndOutlineInitState1775900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "teams" ADD "system_key" varchar`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_teams_system_key" ON "teams" ("system_key") WHERE "system_key" IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE "team_outline_collections" ADD "outline_group_id" varchar`);
    await queryRunner.query(`ALTER TABLE "team_outline_collections" ADD "outline_share_id" varchar`);
    await queryRunner.query(`ALTER TABLE "team_outline_collections" ADD "initialized_at" TIMESTAMP`);
    await queryRunner.query(`
      CREATE TABLE "outline_maintenance_state" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "key" varchar NOT NULL,
        "completed_at" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_outline_maintenance_state" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_outline_maintenance_state_key" ON "outline_maintenance_state" ("key")`);
    const existingStewardsTeam = await queryRunner.query(`
      SELECT "id", "system_key"
      FROM "teams"
      WHERE "name_normalized" = 'stewards'
      LIMIT 1
    `);
    if (existingStewardsTeam.length > 0 && existingStewardsTeam[0].system_key !== 'stewards') {
      throw new Error('Cannot create system Stewards team: a user-created team named "Stewards" already exists');
    }

    await queryRunner.query(`
      INSERT INTO "teams" (
        "id",
        "name",
        "name_normalized",
        "description",
        "system_key",
        "archived_at",
        "archived_by"
      ) VALUES (
        gen_random_uuid(),
        'Stewards',
        'stewards',
        'Public team for CleanCentive platform stewards.',
        'stewards',
        NULL,
        NULL
      )
      ON CONFLICT ("name_normalized") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "system_key" = EXCLUDED."system_key",
        "archived_at" = NULL,
        "archived_by" = NULL,
        "updated_at" = now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "teams" WHERE "system_key" = 'stewards' AND "name_normalized" = 'stewards'`);
    await queryRunner.query(`DROP INDEX "UQ_outline_maintenance_state_key"`);
    await queryRunner.query(`DROP TABLE "outline_maintenance_state"`);
    await queryRunner.query(`ALTER TABLE "team_outline_collections" DROP COLUMN "initialized_at"`);
    await queryRunner.query(`ALTER TABLE "team_outline_collections" DROP COLUMN "outline_share_id"`);
    await queryRunner.query(`ALTER TABLE "team_outline_collections" DROP COLUMN "outline_group_id"`);
    await queryRunner.query(`DROP INDEX "UQ_teams_system_key"`);
    await queryRunner.query(`ALTER TABLE "teams" DROP COLUMN "system_key"`);
  }
}
