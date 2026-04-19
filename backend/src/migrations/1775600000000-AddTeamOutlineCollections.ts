import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamOutlineCollections1775600000000 implements MigrationInterface {
  name = 'AddTeamOutlineCollections1775600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "team_outline_collections" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "team_id" uuid NOT NULL,
        "outline_collection_id" varchar NOT NULL,
        CONSTRAINT "PK_team_outline_collections" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_team_outline_collections_team_id" UNIQUE ("team_id"),
        CONSTRAINT "FK_team_outline_collections_team" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_team_outline_collections_team_id" ON "team_outline_collections" ("team_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "team_outline_collections"`);
  }
}
