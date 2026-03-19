import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingAuthAndFeedback1767000000000 implements MigrationInterface {
  name = 'AddPendingAuthAndFeedback1767000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(`DROP TABLE "pending_auth_requests"`);
    await queryRunner.query(`DROP TYPE "pending_auth_status_enum"`);
  }
}
