import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLlmUsage1777200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Every LLM call we pay for, priced at the time it was made. Mistral has no
    // billing API on our plan, so metering the usage each response already
    // returns is the only way to know what detection costs.
    await queryRunner.query(`
      CREATE TABLE "llm_usage" (
        "id" uuid PRIMARY KEY,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "spot_id" uuid NULL,
        "purpose" varchar(40) NOT NULL,
        "provider_label" varchar(40) NOT NULL,
        "provider_host" varchar(255) NOT NULL,
        "model" varchar(120) NOT NULL,
        "prompt_tokens" integer NOT NULL DEFAULT 0,
        "completion_tokens" integer NOT NULL DEFAULT 0,
        "total_tokens" integer NOT NULL DEFAULT 0,
        "pages" integer NULL,
        "cost_usd" numeric(12,6) NULL,
        CONSTRAINT "fk_llm_usage_spot" FOREIGN KEY ("spot_id")
          REFERENCES "spots"("id") ON DELETE SET NULL
      )
    `);

    // SET NULL rather than CASCADE: purge deletes spots after their retention
    // window, but what we already spent on them is still what we spent.
    await queryRunner.query(`CREATE INDEX "idx_llm_usage_created_at" ON "llm_usage" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "idx_llm_usage_model_created_at" ON "llm_usage" ("model", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "llm_usage"`);
  }
}
