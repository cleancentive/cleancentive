import { MigrationInterface, QueryRunner } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

// Seed data embedded in migration because migrationsRun executes before OnApplicationBootstrap
const SEED_LABELS: Array<{ type: string; translations: Record<string, string> }> = [
  { type: 'object', translations: { en: 'Bottle', de: 'Flasche' } },
  { type: 'object', translations: { en: 'Bottle Cap', de: 'Flaschendeckel' } },
  { type: 'object', translations: { en: 'Can', de: 'Dose' } },
  { type: 'object', translations: { en: 'Cup', de: 'Becher' } },
  { type: 'object', translations: { en: 'Lid', de: 'Deckel' } },
  { type: 'object', translations: { en: 'Straw', de: 'Strohhalm' } },
  { type: 'object', translations: { en: 'Bag', de: 'Tüte' } },
  { type: 'object', translations: { en: 'Wrapper', de: 'Verpackung' } },
  { type: 'object', translations: { en: 'Packaging', de: 'Verpackungsmaterial' } },
  { type: 'object', translations: { en: 'Food Container', de: 'Essensverpackung' } },
  { type: 'object', translations: { en: 'Carton', de: 'Karton' } },
  { type: 'object', translations: { en: 'Box', de: 'Schachtel' } },
  { type: 'object', translations: { en: 'Packet', de: 'Päckchen' } },
  { type: 'object', translations: { en: 'Blister Pack', de: 'Blisterverpackung' } },
  { type: 'object', translations: { en: 'Cigarette Butt', de: 'Zigarettenstummel' } },
  { type: 'object', translations: { en: 'Cigarette Pack', de: 'Zigarettenschachtel' } },
  { type: 'object', translations: { en: 'Lighter', de: 'Feuerzeug' } },
  { type: 'object', translations: { en: 'Mask', de: 'Maske' } },
  { type: 'object', translations: { en: 'Glove', de: 'Handschuh' } },
  { type: 'object', translations: { en: 'Tissue', de: 'Taschentuch' } },
  { type: 'object', translations: { en: 'Napkin', de: 'Serviette' } },
  { type: 'object', translations: { en: 'Utensil', de: 'Besteck' } },
  { type: 'object', translations: { en: 'Plate', de: 'Teller' } },
  { type: 'object', translations: { en: 'Tire', de: 'Reifen' } },
  { type: 'object', translations: { en: 'Clothing', de: 'Kleidung' } },
  { type: 'object', translations: { en: 'Shoe', de: 'Schuh' } },
  { type: 'object', translations: { en: 'Ball', de: 'Ball' } },
  { type: 'object', translations: { en: 'Toy', de: 'Spielzeug' } },
  { type: 'object', translations: { en: 'Balloon', de: 'Ballon' } },
  { type: 'object', translations: { en: 'Toothbrush', de: 'Zahnbürste' } },
  { type: 'object', translations: { en: 'Fishing Line', de: 'Angelschnur' } },
  { type: 'object', translations: { en: 'Rope', de: 'Seil' } },
  { type: 'object', translations: { en: 'Pipe', de: 'Rohr' } },
  { type: 'object', translations: { en: 'Battery', de: 'Batterie' } },
  { type: 'object', translations: { en: 'Electronics', de: 'Elektronik' } },
  { type: 'object', translations: { en: 'Syringe', de: 'Spritze' } },
  { type: 'material', translations: { en: 'Plastic', de: 'Plastik' } },
  { type: 'material', translations: { en: 'Glass', de: 'Glas' } },
  { type: 'material', translations: { en: 'Metal', de: 'Metall' } },
  { type: 'material', translations: { en: 'Aluminum', de: 'Aluminium' } },
  { type: 'material', translations: { en: 'Paper', de: 'Papier' } },
  { type: 'material', translations: { en: 'Cardboard', de: 'Karton' } },
  { type: 'material', translations: { en: 'Paperboard', de: 'Pappe' } },
  { type: 'material', translations: { en: 'Wood', de: 'Holz' } },
  { type: 'material', translations: { en: 'Rubber', de: 'Gummi' } },
  { type: 'material', translations: { en: 'Latex', de: 'Latex' } },
  { type: 'material', translations: { en: 'Fabric', de: 'Stoff' } },
  { type: 'material', translations: { en: 'Styrofoam', de: 'Styropor' } },
  { type: 'material', translations: { en: 'Foil', de: 'Folie' } },
  { type: 'material', translations: { en: 'Ceramic', de: 'Keramik' } },
  { type: 'brand', translations: { en: 'Coca-Cola' } },
  { type: 'brand', translations: { en: 'Pepsi' } },
  { type: 'brand', translations: { en: 'Red Bull' } },
  { type: 'brand', translations: { en: "McDonald's" } },
  { type: 'brand', translations: { en: 'Marlboro' } },
  { type: 'brand', translations: { en: 'Starbucks' } },
  { type: 'brand', translations: { en: 'S.Pellegrino' } },
  { type: 'brand', translations: { en: 'Alpro' } },
  { type: 'brand', translations: { en: 'Bud Light' } },
  { type: 'brand', translations: { en: 'Mezzo Mix' } },
  { type: 'brand', translations: { en: 'Nutella' } },
  { type: 'brand', translations: { en: 'Nature Valley' } },
  { type: 'brand', translations: { en: 'Tango' } },
  { type: 'brand', translations: { en: 'Dolmio' } },
  { type: 'brand', translations: { en: 'Halba' } },
  { type: 'brand', translations: { en: 'Frigot' } },
  { type: 'brand', translations: { en: 'Rug Doctor' } },
  { type: 'brand', translations: { en: 'Aquina' } },
  { type: 'brand', translations: { en: 'Thermo Scientific' } },
  { type: 'brand', translations: { en: 'Fioclys' } },
];

// Explicit mapping of known prod text variants to canonical label names
const CATEGORY_MAP: Record<string, string> = {
  'beer can': 'Can',
  'energy drink can': 'Can',
  'plastic bag': 'Bag',
  'food wrapper': 'Wrapper',
  'candy wrapper': 'Wrapper',
  'plastic wrapper': 'Wrapper',
  'beverage container': 'Carton',
  'beverage carton': 'Carton',
  'carton': 'Carton',
  'condiment packet': 'Packet',
  'tire fragment': 'Tire',
  'footwear': 'Shoe',
  'bottle cap': 'Bottle Cap',
};

const MATERIAL_MAP: Record<string, string> = {
  'foam': 'Styrofoam',
  'aluminum foil': 'Foil',
  'plastic and tobacco': 'Plastic',
};

export class MigrateTextToLabels1775000000000 implements MigrationInterface {
  name = 'MigrateTextToLabels1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Stage A: Seed labels idempotently
    for (const entry of SEED_LABELS) {
      const enName = entry.translations.en;
      if (!enName) continue;

      const existing = await queryRunner.query(
        `SELECT l.id FROM labels l
         JOIN label_translations lt ON lt.label_id = l.id
         WHERE l.type = $1 AND lt.locale = 'en' AND LOWER(lt.name) = LOWER($2)`,
        [entry.type, enName],
      );

      if (existing.length > 0) continue;

      const labelId = uuidv7();
      await queryRunner.query(
        `INSERT INTO labels (id, type) VALUES ($1, $2)`,
        [labelId, entry.type],
      );

      for (const [locale, name] of Object.entries(entry.translations)) {
        await queryRunner.query(
          `INSERT INTO label_translations (id, label_id, locale, name) VALUES ($1, $2, $3, $4)`,
          [uuidv7(), labelId, locale, name],
        );
      }
    }

    // Stage B: Map existing detected_items text to labels
    // Check if text columns still exist (they won't in dev where synchronize:true already dropped them)
    const columns = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'detected_items' AND column_name IN ('category', 'material', 'brand')`,
    );
    const hasTextColumns = columns.length > 0;

    if (!hasTextColumns) {
      // Text columns already removed by synchronize — skip mapping and dropping
      return;
    }

    // B1: Apply explicit category mappings
    for (const [variant, canonical] of Object.entries(CATEGORY_MAP)) {
      await queryRunner.query(
        `UPDATE detected_items di
         SET object_label_id = l.id
         FROM labels l
         JOIN label_translations lt ON lt.label_id = l.id
         WHERE lt.locale = 'en'
           AND LOWER(lt.name) = LOWER($1)
           AND l.type = 'object'
           AND di.object_label_id IS NULL
           AND LOWER(di.category) = LOWER($2)`,
        [canonical, variant],
      );
    }

    // B2: Apply explicit material mappings
    for (const [variant, canonical] of Object.entries(MATERIAL_MAP)) {
      await queryRunner.query(
        `UPDATE detected_items di
         SET material_label_id = l.id
         FROM labels l
         JOIN label_translations lt ON lt.label_id = l.id
         WHERE lt.locale = 'en'
           AND LOWER(lt.name) = LOWER($1)
           AND l.type = 'material'
           AND di.material_label_id IS NULL
           AND LOWER(di.material) = LOWER($2)`,
        [canonical, variant],
      );
    }

    // B3: Handle "plastic"/"Plastic" in category column — it's a misclassified material
    await queryRunner.query(
      `UPDATE detected_items di
       SET material_label_id = COALESCE(di.material_label_id, l.id)
       FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       WHERE lt.locale = 'en'
         AND LOWER(lt.name) = 'plastic'
         AND l.type = 'material'
         AND LOWER(di.category) = 'plastic'
         AND di.object_label_id IS NULL`,
    );
    // Clear the category text for these rows so they don't get matched as objects
    await queryRunner.query(
      `UPDATE detected_items
       SET category = NULL
       WHERE LOWER(category) = 'plastic'
         AND object_label_id IS NULL`,
    );

    // B4: Direct case-insensitive match for remaining categories
    await queryRunner.query(
      `UPDATE detected_items di
       SET object_label_id = l.id
       FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       WHERE lt.locale = 'en'
         AND LOWER(lt.name) = LOWER(di.category)
         AND l.type = 'object'
         AND di.object_label_id IS NULL
         AND di.category IS NOT NULL`,
    );

    // B5: Direct case-insensitive match for remaining materials
    await queryRunner.query(
      `UPDATE detected_items di
       SET material_label_id = l.id
       FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       WHERE lt.locale = 'en'
         AND LOWER(lt.name) = LOWER(di.material)
         AND l.type = 'material'
         AND di.material_label_id IS NULL
         AND di.material IS NOT NULL`,
    );

    // B6: Direct case-insensitive match for remaining brands
    await queryRunner.query(
      `UPDATE detected_items di
       SET brand_label_id = l.id
       FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       WHERE lt.locale = 'en'
         AND LOWER(lt.name) = LOWER(di.brand)
         AND l.type = 'brand'
         AND di.brand_label_id IS NULL
         AND di.brand IS NOT NULL`,
    );

    // B7: Auto-create labels for any remaining unmatched values
    await this.autoCreateUnmatched(queryRunner, 'category', 'object', 'object_label_id');
    await this.autoCreateUnmatched(queryRunner, 'material', 'material', 'material_label_id');
    await this.autoCreateUnmatched(queryRunner, 'brand', 'brand', 'brand_label_id');

    // Stage C: Drop text columns
    await queryRunner.query(`ALTER TABLE detected_items DROP COLUMN category`);
    await queryRunner.query(`ALTER TABLE detected_items DROP COLUMN material`);
    await queryRunner.query(`ALTER TABLE detected_items DROP COLUMN brand`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add text columns
    await queryRunner.query(`ALTER TABLE detected_items ADD COLUMN category varchar`);
    await queryRunner.query(`ALTER TABLE detected_items ADD COLUMN material varchar`);
    await queryRunner.query(`ALTER TABLE detected_items ADD COLUMN brand varchar`);

    // Populate from label translations
    await queryRunner.query(
      `UPDATE detected_items di
       SET category = lt.name
       FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       WHERE l.id = di.object_label_id
         AND lt.locale = 'en'`,
    );
    await queryRunner.query(
      `UPDATE detected_items di
       SET material = lt.name
       FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       WHERE l.id = di.material_label_id
         AND lt.locale = 'en'`,
    );
    await queryRunner.query(
      `UPDATE detected_items di
       SET brand = lt.name
       FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       WHERE l.id = di.brand_label_id
         AND lt.locale = 'en'`,
    );
  }

  private async autoCreateUnmatched(
    queryRunner: QueryRunner,
    textColumn: string,
    labelType: string,
    fkColumn: string,
  ): Promise<void> {
    const unmatched: Array<{ value: string }> = await queryRunner.query(
      `SELECT DISTINCT ${textColumn} AS value FROM detected_items
       WHERE ${textColumn} IS NOT NULL AND ${fkColumn} IS NULL`,
    );

    for (const { value } of unmatched) {
      const titleCased = value.replace(/\b\w/g, (c) => c.toUpperCase());
      const labelId = uuidv7();

      await queryRunner.query(
        `INSERT INTO labels (id, type) VALUES ($1, $2)`,
        [labelId, labelType],
      );
      await queryRunner.query(
        `INSERT INTO label_translations (id, label_id, locale, name) VALUES ($1, $2, 'en', $3)`,
        [uuidv7(), labelId, titleCased],
      );

      await queryRunner.query(
        `UPDATE detected_items SET ${fkColumn} = $1
         WHERE LOWER(${textColumn}) = LOWER($2) AND ${fkColumn} IS NULL`,
        [labelId, value],
      );
    }
  }
}
