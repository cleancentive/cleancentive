import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleanupFeeds1777300001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A team can mirror an external cleanup listing. One row per listing; the
    // adapter named by "kind" knows how to read it.
    await queryRunner.query(`
      CREATE TABLE "cleanup_feeds" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "team_id" uuid NOT NULL,
        "kind" varchar(40) NOT NULL,
        "url" varchar(2048) NOT NULL,
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "enabled" boolean NOT NULL DEFAULT true,
        "last_run_at" TIMESTAMP WITH TIME ZONE NULL,
        "last_success_at" TIMESTAMP WITH TIME ZONE NULL,
        "last_error" text NULL,
        "last_summary" jsonb NULL,
        CONSTRAINT "PK_cleanup_feeds_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cleanup_feeds_team_id" FOREIGN KEY ("team_id")
          REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_feeds_team_id" ON "cleanup_feeds" ("team_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_cleanup_feeds_team_url" ON "cleanup_feeds" ("team_id", "url")`);

    // Provenance of a mirrored cleanup. external_version is an opaque change
    // marker from the source (a modification date, a hash — whatever the adapter
    // can compare), and sync_snapshot is what the feed itself last wrote, so a
    // later run can tell its own values apart from a human's corrections.
    await queryRunner.query(`ALTER TABLE "cleanups" ADD "feed_id" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "cleanups" ADD "external_id" varchar(191) NULL`);
    await queryRunner.query(`ALTER TABLE "cleanups" ADD "external_url" varchar(2048) NULL`);
    await queryRunner.query(`ALTER TABLE "cleanups" ADD "external_version" varchar(64) NULL`);
    await queryRunner.query(`ALTER TABLE "cleanups" ADD "synced_at" TIMESTAMP WITH TIME ZONE NULL`);
    await queryRunner.query(`ALTER TABLE "cleanups" ADD "sync_snapshot" jsonb NULL`);
    await queryRunner.query(`
      ALTER TABLE "cleanups"
      ADD CONSTRAINT "FK_cleanups_feed_id"
      FOREIGN KEY ("feed_id") REFERENCES "cleanup_feeds"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    // Deliberately not unique: sources reuse an id across seasons, so the same
    // external_id legitimately appears once per edition.
    await queryRunner.query(`CREATE INDEX "IDX_cleanups_feed_external" ON "cleanups" ("feed_id", "external_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_cleanups_feed_external"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP CONSTRAINT "FK_cleanups_feed_id"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP COLUMN "sync_snapshot"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP COLUMN "synced_at"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP COLUMN "external_version"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP COLUMN "external_url"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP COLUMN "external_id"`);
    await queryRunner.query(`ALTER TABLE "cleanups" DROP COLUMN "feed_id"`);
    await queryRunner.query(`DROP TABLE "cleanup_feeds"`);
  }
}
