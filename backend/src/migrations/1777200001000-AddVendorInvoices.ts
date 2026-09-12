import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVendorInvoices1777200001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Invoices parsed out of the PDFs attached to the wiki billing document.
    // This is the only source of real invoiced spend — no vendor we use offers
    // a billing API on our plans.
    await queryRunner.query(`
      CREATE TABLE "vendor_invoices" (
        "id" uuid PRIMARY KEY,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "attachment_id" uuid NOT NULL,
        "outline_document_id" uuid NULL,
        "file_name" varchar(512) NOT NULL,
        "vendor" varchar(40) NOT NULL,
        "invoice_date" date NULL,
        "period_start" date NULL,
        "period_end" date NULL,
        "currency" varchar(3) NULL,
        "amount_gross" numeric(12,2) NULL,
        "amount_chf" numeric(12,2) NULL,
        "fx_rate" numeric(12,6) NULL,
        "parse_status" varchar(20) NOT NULL,
        "parsed_raw" jsonb NULL,
        "confirmed_by" uuid NULL,
        "confirmed_at" TIMESTAMP WITH TIME ZONE NULL
      )
    `);

    // The idempotence key. An attachment is OCR'd exactly once, ever — that is
    // what keeps re-scanning the wiki free.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_vendor_invoices_attachment" ON "vendor_invoices" ("attachment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vendor_invoices_date" ON "vendor_invoices" ("invoice_date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "vendor_invoices"`);
  }
}
