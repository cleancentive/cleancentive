import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema0000000000000 implements MigrationInterface {
  name = 'InitialSchema0000000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Users & Auth ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "nickname" varchar NOT NULL,
        "full_name" varchar,
        "last_login" TIMESTAMP,
        "active_team_id" uuid,
        "active_cleanup_date_id" uuid,
        "avatar_email_id" uuid,
        CONSTRAINT "PK_96aac72f1574b88752e9fb00089" PRIMARY KEY ("id")
      )
    `);

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

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1e3fbac1c2f88e5b6e1b6c6e1e" ON "user_emails" ("email")`);
    await queryRunner.query(
      `ALTER TABLE "user_emails" ADD CONSTRAINT "FK_1e3fbac1c2f88e5b6e1b6c6e1e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

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
        CONSTRAINT "FK_admins_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "pending_auth_status_enum" AS ENUM ('pending', 'completed')
    `);
    await queryRunner.query(`
      CREATE TABLE "pending_auth_requests" (
        "id" uuid NOT NULL,
        "userId" varchar NOT NULL,
        "sessionToken" text,
        "status" "pending_auth_status_enum" NOT NULL DEFAULT 'pending',
        "expiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_pending_auth_requests" PRIMARY KEY ("id")
      )
    `);

    // ── Teams ─────────────────────────────────────────────────────────
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
        "custom_css" text,
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
        CONSTRAINT "CHK_team_memberships_role" CHECK ("role" IN ('member', 'organizer'))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_team_memberships_team_user" ON "team_memberships" ("team_id", "user_id")`);
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
        CONSTRAINT "CHK_team_messages_audience" CHECK ("audience" IN ('members', 'organizers'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_team_messages_team_id" ON "team_messages" ("team_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_team_messages_created_at" ON "team_messages" ("created_at")`);

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

    // ── Cleanups ──────────────────────────────────────────────────────
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
        "recurrence_id" uuid,
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
        CONSTRAINT "CHK_cleanup_participants_role" CHECK ("role" IN ('member', 'organizer'))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_cleanup_participants_cleanup_user" ON "cleanup_participants" ("cleanup_id", "user_id")`);
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
        CONSTRAINT "CHK_cleanup_messages_audience" CHECK ("audience" IN ('members', 'organizers'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_messages_cleanup_id" ON "cleanup_messages" ("cleanup_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cleanup_messages_created_at" ON "cleanup_messages" ("created_at")`);

    // ── Users FK to teams & cleanup_dates (after those tables exist) ─
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_active_team_id" FOREIGN KEY ("active_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_active_cleanup_date_id" FOREIGN KEY ("active_cleanup_date_id") REFERENCES "cleanup_dates"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_avatar_email_id" FOREIGN KEY ("avatar_email_id") REFERENCES "user_emails"("id") ON DELETE SET NULL`,
    );

    // ── Spots & Detection ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "spots" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "user_id" uuid NOT NULL,
        "team_id" uuid,
        "cleanup_id" uuid,
        "cleanup_date_id" uuid,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "location_accuracy_meters" double precision NOT NULL,
        "captured_at" TIMESTAMP NOT NULL,
        "mime_type" varchar NOT NULL,
        "image_key" varchar NOT NULL,
        "thumbnail_key" varchar,
        "upload_id" varchar NOT NULL,
        "processing_status" varchar NOT NULL DEFAULT 'queued',
        "detection_started_at" TIMESTAMP,
        "detection_completed_at" TIMESTAMP,
        "processing_error" text,
        "detection_raw" jsonb,
        "original_size_bytes" bigint NOT NULL DEFAULT 0,
        "thumbnail_size_bytes" bigint NOT NULL DEFAULT 0,
        "original_purged_at" TIMESTAMP,
        CONSTRAINT "PK_spots_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_spots_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_spots_team_id" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_spots_cleanup_id" FOREIGN KEY ("cleanup_id") REFERENCES "cleanups"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_spots_cleanup_date_id" FOREIGN KEY ("cleanup_date_id") REFERENCES "cleanup_dates"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "CHK_spots_cleanup_link" CHECK (
          ("cleanup_id" IS NULL AND "cleanup_date_id" IS NULL)
          OR ("cleanup_id" IS NOT NULL AND "cleanup_date_id" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_spots_upload_id" ON "spots" ("upload_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_user_id" ON "spots" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_processing_status" ON "spots" ("processing_status")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_team_id" ON "spots" ("team_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_cleanup_id" ON "spots" ("cleanup_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_cleanup_date_id" ON "spots" ("cleanup_date_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_original_purged_at" ON "spots" ("original_purged_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_spots_captured_at" ON "spots" ("captured_at")`);

    // ── Labels & Taxonomy ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "labels" (
        "id" uuid NOT NULL,
        "type" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        CONSTRAINT "PK_labels" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_labels_type" CHECK ("type" IN ('object', 'material', 'brand'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_labels_type" ON "labels" ("type")`);

    await queryRunner.query(`
      CREATE TABLE "label_translations" (
        "id" uuid NOT NULL,
        "label_id" uuid NOT NULL,
        "locale" varchar(10) NOT NULL,
        "name" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        CONSTRAINT "PK_label_translations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_label_translations_label_locale" UNIQUE ("label_id", "locale")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "label_translations" ADD CONSTRAINT "FK_label_translations_label_id" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "detected_items" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "spot_id" uuid NOT NULL,
        "category" varchar,
        "material" varchar,
        "brand" varchar,
        "object_label_id" uuid,
        "material_label_id" uuid,
        "brand_label_id" uuid,
        "match_confidence" double precision,
        "human_verified" boolean NOT NULL DEFAULT false,
        "weight_grams" double precision,
        "confidence" double precision,
        "source_model" varchar,
        CONSTRAINT "PK_detected_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_detected_items_spot_id" FOREIGN KEY ("spot_id") REFERENCES "spots"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_detected_items_object_label_id" FOREIGN KEY ("object_label_id") REFERENCES "labels"("id"),
        CONSTRAINT "FK_detected_items_material_label_id" FOREIGN KEY ("material_label_id") REFERENCES "labels"("id"),
        CONSTRAINT "FK_detected_items_brand_label_id" FOREIGN KEY ("brand_label_id") REFERENCES "labels"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_detected_items_spot_id" ON "detected_items" ("spot_id")`);

    await queryRunner.query(`
      CREATE TABLE "detected_item_edits" (
        "id" uuid NOT NULL,
        "detected_item_id" uuid NOT NULL,
        "field_changed" varchar NOT NULL,
        "old_value" varchar,
        "new_value" varchar,
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_detected_item_edits" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_detected_item_edits_detected_item_id" ON "detected_item_edits" ("detected_item_id")`);
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" ADD CONSTRAINT "FK_detected_item_edits_detected_item_id" FOREIGN KEY ("detected_item_id") REFERENCES "detected_items"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" ADD CONSTRAINT "FK_detected_item_edits_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id")`,
    );

    // ── Feedback ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "feedback" (
        "id" uuid NOT NULL,
        "category" varchar NOT NULL,
        "description" text NOT NULL,
        "status" varchar NOT NULL DEFAULT 'new',
        "contact_email" varchar,
        "user_id" uuid,
        "guest_id" uuid,
        "error_context" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        CONSTRAINT "PK_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "FK_feedback_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_feedback_user_id" ON "feedback" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_feedback_status" ON "feedback" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_feedback_guest_id" ON "feedback" ("guest_id")`);

    await queryRunner.query(`
      CREATE TABLE "feedback_responses" (
        "id" uuid NOT NULL,
        "feedback_id" uuid NOT NULL,
        "message" text NOT NULL,
        "is_from_steward" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        CONSTRAINT "PK_feedback_responses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_feedback_responses_feedback" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_feedback_responses_feedback_id" ON "feedback_responses" ("feedback_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "feedback_responses"`);
    await queryRunner.query(`DROP TABLE "feedback"`);
    await queryRunner.query(`DROP TABLE "detected_item_edits"`);
    await queryRunner.query(`DROP TABLE "detected_items"`);
    await queryRunner.query(`DROP TABLE "label_translations"`);
    await queryRunner.query(`DROP TABLE "labels"`);
    await queryRunner.query(`DROP TABLE "spots"`);
    await queryRunner.query(`DROP TABLE "cleanup_messages"`);
    await queryRunner.query(`DROP TABLE "cleanup_participants"`);
    await queryRunner.query(`DROP TABLE "cleanup_dates"`);
    await queryRunner.query(`DROP TABLE "cleanups"`);
    await queryRunner.query(`DROP TABLE "team_email_patterns"`);
    await queryRunner.query(`DROP TABLE "team_messages"`);
    await queryRunner.query(`DROP TABLE "team_memberships"`);
    await queryRunner.query(`DROP TABLE "teams"`);
    await queryRunner.query(`DROP TABLE "pending_auth_requests"`);
    await queryRunner.query(`DROP TYPE "pending_auth_status_enum"`);
    await queryRunner.query(`DROP TABLE "admins"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_avatar_email_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_active_cleanup_date_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_active_team_id"`);
    await queryRunner.query(`DROP TABLE "user_emails"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
