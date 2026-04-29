import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutlineWebhookSecretAndEventLog1775700000000 implements MigrationInterface {
  name = 'AddOutlineWebhookSecretAndEventLog1775700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outline_webhook_config" (
        "id" uuid NOT NULL,
        "secret" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        CONSTRAINT "PK_outline_webhook_config" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "outline_events" (
        "id" uuid NOT NULL,
        "received_at" TIMESTAMP NOT NULL DEFAULT now(),
        "event_type" varchar NOT NULL,
        "actor_id" uuid,
        "document_id" uuid,
        "collection_id" uuid,
        "payload" jsonb NOT NULL,
        CONSTRAINT "PK_outline_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_outline_events_received_at" ON "outline_events" ("received_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_outline_events_event_type" ON "outline_events" ("event_type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "outline_events"`);
    await queryRunner.query(`DROP TABLE "outline_webhook_config"`);
  }
}
