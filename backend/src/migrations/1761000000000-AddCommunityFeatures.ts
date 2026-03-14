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
      CREATE TABLE "cleanups" (
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
        CONSTRAINT "PK_cleanups_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_cleanups_name_normalized" ON "cleanups" ("name_normalized")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanups_archived_at" ON "cleanups" ("archived_at")`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_dates" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "cleanup_id" uuid NOT NULL,
        "start_at" TIMESTAMP NOT NULL,
        "end_at" TIMESTAMP NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "location_name" varchar,
        CONSTRAINT "PK_cleanup_dates_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cleanup_dates_cleanup_id" FOREIGN KEY ("cleanup_id") REFERENCES "cleanups"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_cleanup_dates_time" CHECK ("end_at" > "start_at")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_cleanup_dates_cleanup_id" ON "cleanup_dates" ("cleanup_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_dates_start_at" ON "cleanup_dates" ("start_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_dates_end_at" ON "cleanup_dates" ("end_at")`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_participants" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "cleanup_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" varchar NOT NULL DEFAULT 'member',
        CONSTRAINT "PK_cleanup_participants_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cleanup_participants_cleanup_id" FOREIGN KEY ("cleanup_id") REFERENCES "cleanups"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_cleanup_participants_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_cleanup_participants_role" CHECK ("role" IN ('member', 'admin'))
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_cleanup_participants_cleanup_user" ON "cleanup_participants" ("cleanup_id", "user_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_participants_cleanup_id" ON "cleanup_participants" ("cleanup_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_participants_user_id" ON "cleanup_participants" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_messages" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "cleanup_id" uuid NOT NULL,
        "author_user_id" uuid NOT NULL,
        "audience" varchar NOT NULL,
        "subject" varchar NOT NULL,
        "body" text NOT NULL,
        CONSTRAINT "PK_cleanup_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cleanup_messages_cleanup_id" FOREIGN KEY ("cleanup_id") REFERENCES "cleanups"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_cleanup_messages_author_user_id" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_cleanup_messages_audience" CHECK ("audience" IN ('members', 'admins'))
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_cleanup_messages_cleanup_id" ON "cleanup_messages" ("cleanup_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_messages_created_at" ON "cleanup_messages" ("created_at")`);

    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "active_team_id" uuid`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "active_cleanup_date_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_active_team_id" FOREIGN KEY ("active_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_active_cleanup_date_id" FOREIGN KEY ("active_cleanup_date_id") REFERENCES "cleanup_dates"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "spots" ADD COLUMN "team_id" uuid`);
    await queryRunner.query(`ALTER TABLE "spots" ADD COLUMN "cleanup_id" uuid`);
    await queryRunner.query(`ALTER TABLE "spots" ADD COLUMN "cleanup_date_id" uuid`);

    await queryRunner.query(
      `ALTER TABLE "spots" ADD CONSTRAINT "FK_spots_team_id" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "spots" ADD CONSTRAINT "FK_spots_cleanup_id" FOREIGN KEY ("cleanup_id") REFERENCES "cleanups"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "spots" ADD CONSTRAINT "FK_spots_cleanup_date_id" FOREIGN KEY ("cleanup_date_id") REFERENCES "cleanup_dates"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`CREATE INDEX "IDX_spots_team_id" ON "spots" ("team_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_cleanup_id" ON "spots" ("cleanup_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_cleanup_date_id" ON "spots" ("cleanup_date_id")`);

    await queryRunner.query(`
      ALTER TABLE "spots"
      ADD CONSTRAINT "CHK_spots_cleanup_link"
      CHECK (
        ("cleanup_id" IS NULL AND "cleanup_date_id" IS NULL)
        OR ("cleanup_id" IS NOT NULL AND "cleanup_date_id" IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "spots" DROP CONSTRAINT "CHK_spots_cleanup_link"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_cleanup_date_id"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_cleanup_id"`);
    await queryRunner.query(`DROP INDEX "IDX_spots_team_id"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP CONSTRAINT "FK_spots_cleanup_date_id"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP CONSTRAINT "FK_spots_cleanup_id"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP CONSTRAINT "FK_spots_team_id"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "cleanup_date_id"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "cleanup_id"`);
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "team_id"`);

    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_active_cleanup_date_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_active_team_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "active_cleanup_date_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "active_team_id"`);

    await queryRunner.query(`DROP INDEX "IDX_cleanup_messages_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_messages_cleanup_id"`);
    await queryRunner.query(`DROP TABLE "cleanup_messages"`);

    await queryRunner.query(`DROP INDEX "IDX_cleanup_participants_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_participants_cleanup_id"`);
    await queryRunner.query(`DROP INDEX "UQ_cleanup_participants_cleanup_user"`);
    await queryRunner.query(`DROP TABLE "cleanup_participants"`);

    await queryRunner.query(`DROP INDEX "IDX_cleanup_dates_end_at"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_dates_start_at"`);
    await queryRunner.query(`DROP INDEX "IDX_cleanup_dates_cleanup_id"`);
    await queryRunner.query(`DROP TABLE "cleanup_dates"`);

    await queryRunner.query(`DROP INDEX "IDX_cleanups_archived_at"`);
    await queryRunner.query(`DROP INDEX "UQ_cleanups_name_normalized"`);
    await queryRunner.query(`DROP TABLE "cleanups"`);

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
