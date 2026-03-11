import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityFeatures1761000000000 implements MigrationInterface {
  name = 'AddCommunityFeatures1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "teams" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "name" varchar NOT NULL,
        "name_normalized" varchar NOT NULL,
        "description" text NOT NULL,
        "archived_at" TIMESTAMP,
        "archived_by" uuid,
        CONSTRAINT "PK_teams_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_teams_name_normalized" ON "teams" ("name_normalized")`);
    await queryRunner.query(`CREATE INDEX "IDX_teams_archived_at" ON "teams" ("archived_at")`);

    await queryRunner.query(`
      CREATE TABLE "team_memberships" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "team_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" varchar NOT NULL DEFAULT 'member',
        CONSTRAINT "PK_team_memberships_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_team_memberships_team_id" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_team_memberships_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_team_memberships_role" CHECK ("role" IN ('member', 'admin'))
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_team_memberships_team_user" ON "team_memberships" ("team_id", "user_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_team_memberships_team_id" ON "team_memberships" ("team_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_team_memberships_user_id" ON "team_memberships" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "team_messages" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "team_id" uuid NOT NULL,
        "author_user_id" uuid NOT NULL,
        "audience" varchar NOT NULL,
        "subject" varchar NOT NULL,
        "body" text NOT NULL,
        CONSTRAINT "PK_team_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_team_messages_team_id" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_team_messages_author_user_id" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_team_messages_audience" CHECK ("audience" IN ('members', 'admins'))
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_team_messages_team_id" ON "team_messages" ("team_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_team_messages_created_at" ON "team_messages" ("created_at")`);

    await queryRunner.query(`
      CREATE TABLE "events" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "name" varchar NOT NULL,
        "name_normalized" varchar NOT NULL,
        "description" text NOT NULL,
        "archived_at" TIMESTAMP,
        "archived_by" uuid,
        CONSTRAINT "PK_events_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_events_name_normalized" ON "events" ("name_normalized")`);
    await queryRunner.query(`CREATE INDEX "IDX_events_archived_at" ON "events" ("archived_at")`);

    await queryRunner.query(`
      CREATE TABLE "event_occurrences" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "event_id" uuid NOT NULL,
        "start_at" TIMESTAMP NOT NULL,
        "end_at" TIMESTAMP NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "location_name" varchar,
        CONSTRAINT "PK_event_occurrences_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_event_occurrences_event_id" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_event_occurrences_time" CHECK ("end_at" > "start_at")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_event_occurrences_event_id" ON "event_occurrences" ("event_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_event_occurrences_start_at" ON "event_occurrences" ("start_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_event_occurrences_end_at" ON "event_occurrences" ("end_at")`);

    await queryRunner.query(`
      CREATE TABLE "event_participants" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "event_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" varchar NOT NULL DEFAULT 'member',
        CONSTRAINT "PK_event_participants_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_event_participants_event_id" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_event_participants_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_event_participants_role" CHECK ("role" IN ('member', 'admin'))
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_event_participants_event_user" ON "event_participants" ("event_id", "user_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_event_participants_event_id" ON "event_participants" ("event_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_event_participants_user_id" ON "event_participants" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "event_messages" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "event_id" uuid NOT NULL,
        "author_user_id" uuid NOT NULL,
        "audience" varchar NOT NULL,
        "subject" varchar NOT NULL,
        "body" text NOT NULL,
        CONSTRAINT "PK_event_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_event_messages_event_id" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_event_messages_author_user_id" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_event_messages_audience" CHECK ("audience" IN ('members', 'admins'))
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_event_messages_event_id" ON "event_messages" ("event_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_event_messages_created_at" ON "event_messages" ("created_at")`);

    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "active_team_id" uuid`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "active_event_occurrence_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_active_team_id" FOREIGN KEY ("active_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_active_event_occurrence_id" FOREIGN KEY ("active_event_occurrence_id") REFERENCES "event_occurrences"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "cleanup_reports" ADD COLUMN "team_id" uuid`);
    await queryRunner.query(`ALTER TABLE "cleanup_reports" ADD COLUMN "event_id" uuid`);
    await queryRunner.query(`ALTER TABLE "cleanup_reports" ADD COLUMN "event_occurrence_id" uuid`);

    await queryRunner.query(
      `ALTER TABLE "cleanup_reports" ADD CONSTRAINT "FK_cleanup_reports_team_id" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleanup_reports" ADD CONSTRAINT "FK_cleanup_reports_event_id" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleanup_reports" ADD CONSTRAINT "FK_cleanup_reports_event_occurrence_id" FOREIGN KEY ("event_occurrence_id") REFERENCES "event_occurrences"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`CREATE INDEX "IDX_cleanup_reports_team_id" ON "cleanup_reports" ("team_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_reports_event_id" ON "cleanup_reports" ("event_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_reports_event_occurrence_id" ON "cleanup_reports" ("event_occurrence_id")`);

    await queryRunner.query(`
      ALTER TABLE "cleanup_reports"
      ADD CONSTRAINT "CHK_cleanup_reports_event_link"
      CHECK (
        ("event_id" IS NULL AND "event_occurrence_id" IS NULL)
        OR ("event_id" IS NOT NULL AND "event_occurrence_id" IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cleanup_reports" DROP CONSTRAINT "CHK_cleanup_reports_event_link"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_reports_event_occurrence_id"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_reports_event_id"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_reports_team_id"`);
    await queryRunner.query(`ALTER TABLE "cleanup_reports" DROP CONSTRAINT "FK_cleanup_reports_event_occurrence_id"`);
    await queryRunner.query(`ALTER TABLE "cleanup_reports" DROP CONSTRAINT "FK_cleanup_reports_event_id"`);
    await queryRunner.query(`ALTER TABLE "cleanup_reports" DROP CONSTRAINT "FK_cleanup_reports_team_id"`);
    await queryRunner.query(`ALTER TABLE "cleanup_reports" DROP COLUMN "event_occurrence_id"`);
    await queryRunner.query(`ALTER TABLE "cleanup_reports" DROP COLUMN "event_id"`);
    await queryRunner.query(`ALTER TABLE "cleanup_reports" DROP COLUMN "team_id"`);

    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_active_event_occurrence_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_active_team_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "active_event_occurrence_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "active_team_id"`);

    await queryRunner.query(`DROP INDEX "IDX_event_messages_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_event_messages_event_id"`);
    await queryRunner.query(`DROP TABLE "event_messages"`);

    await queryRunner.query(`DROP INDEX "IDX_event_participants_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_event_participants_event_id"`);
    await queryRunner.query(`DROP INDEX "UQ_event_participants_event_user"`);
    await queryRunner.query(`DROP TABLE "event_participants"`);

    await queryRunner.query(`DROP INDEX "IDX_event_occurrences_end_at"`);
    await queryRunner.query(`DROP INDEX "IDX_event_occurrences_start_at"`);
    await queryRunner.query(`DROP INDEX "IDX_event_occurrences_event_id"`);
    await queryRunner.query(`DROP TABLE "event_occurrences"`);

    await queryRunner.query(`DROP INDEX "IDX_events_archived_at"`);
    await queryRunner.query(`DROP INDEX "UQ_events_name_normalized"`);
    await queryRunner.query(`DROP TABLE "events"`);

    await queryRunner.query(`DROP INDEX "IDX_team_messages_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_team_messages_team_id"`);
    await queryRunner.query(`DROP TABLE "team_messages"`);

    await queryRunner.query(`DROP INDEX "IDX_team_memberships_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_team_memberships_team_id"`);
    await queryRunner.query(`DROP INDEX "UQ_team_memberships_team_user"`);
    await queryRunner.query(`DROP TABLE "team_memberships"`);

    await queryRunner.query(`DROP INDEX "IDX_teams_archived_at"`);
    await queryRunner.query(`DROP INDEX "UQ_teams_name_normalized"`);
    await queryRunner.query(`DROP TABLE "teams"`);
  }
}
