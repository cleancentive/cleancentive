import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLabelTaxonomy1766000000000 implements MigrationInterface {
  name = 'AddLabelTaxonomy1766000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(
      `CREATE INDEX "IDX_detected_item_edits_detected_item_id" ON "detected_item_edits" ("detected_item_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" ADD CONSTRAINT "FK_detected_item_edits_detected_item_id" FOREIGN KEY ("detected_item_id") REFERENCES "detected_items"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_item_edits" ADD CONSTRAINT "FK_detected_item_edits_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id")`,
    );

    await queryRunner.query(`ALTER TABLE "detected_items" ADD COLUMN "object_label_id" uuid`);
    await queryRunner.query(`ALTER TABLE "detected_items" ADD COLUMN "material_label_id" uuid`);
    await queryRunner.query(`ALTER TABLE "detected_items" ADD COLUMN "brand_label_id" uuid`);
    await queryRunner.query(`ALTER TABLE "detected_items" ADD COLUMN "match_confidence" double precision`);
    await queryRunner.query(
      `ALTER TABLE "detected_items" ADD COLUMN "human_verified" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `ALTER TABLE "detected_items" ADD CONSTRAINT "FK_detected_items_object_label_id" FOREIGN KEY ("object_label_id") REFERENCES "labels"("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_items" ADD CONSTRAINT "FK_detected_items_material_label_id" FOREIGN KEY ("material_label_id") REFERENCES "labels"("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "detected_items" ADD CONSTRAINT "FK_detected_items_brand_label_id" FOREIGN KEY ("brand_label_id") REFERENCES "labels"("id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "detected_items" DROP CONSTRAINT "FK_detected_items_brand_label_id"`);
    await queryRunner.query(`ALTER TABLE "detected_items" DROP CONSTRAINT "FK_detected_items_material_label_id"`);
    await queryRunner.query(`ALTER TABLE "detected_items" DROP CONSTRAINT "FK_detected_items_object_label_id"`);
    await queryRunner.query(`ALTER TABLE "detected_items" DROP COLUMN "human_verified"`);
    await queryRunner.query(`ALTER TABLE "detected_items" DROP COLUMN "match_confidence"`);
    await queryRunner.query(`ALTER TABLE "detected_items" DROP COLUMN "brand_label_id"`);
    await queryRunner.query(`ALTER TABLE "detected_items" DROP COLUMN "material_label_id"`);
    await queryRunner.query(`ALTER TABLE "detected_items" DROP COLUMN "object_label_id"`);
    await queryRunner.query(`DROP TABLE "detected_item_edits"`);
    await queryRunner.query(`DROP TABLE "label_translations"`);
    await queryRunner.query(`DROP TABLE "labels"`);
  }
}
