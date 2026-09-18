import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleanupTeamId1777300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cleanups were organized by people only. A team that runs cleanups
    // together had no way to say so, and no place to list them.
    await queryRunner.query(`ALTER TABLE "cleanups" ADD "team_id" uuid NULL`);
    await queryRunner.query(`
      ALTER TABLE "cleanups"
      ADD CONSTRAINT "FK_cleanups_team_id"
      FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`CREATE INDEX "IDX_cleanups_team_id" ON "cleanups" ("team_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_cleanups_team_id"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP CONSTRAINT "FK_cleanups_team_id"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP COLUMN "team_id"`);
  }
}
