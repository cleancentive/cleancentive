import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { PROCESSING_STATUS } from '@cleancentive/shared';
import type { PlantIdentificationResult } from './identifiers/types';

const PLANT_MATTER_MATERIAL_NAME = 'Plant matter';

async function resolveSpeciesLabel(
  client: PoolClient,
  scientificName: string,
  commonName: string | null,
  userId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM labels WHERE type = 'object' AND LOWER(scientific_name) = LOWER($1) LIMIT 1`,
    [scientificName],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const labelId = uuidv7();
  await client.query(
    `INSERT INTO labels (id, type, scientific_name, created_at, updated_at, created_by, updated_by)
     VALUES ($1, 'object', $2, NOW(), NOW(), $3, $3)
     ON CONFLICT DO NOTHING`,
    [labelId, scientificName, userId],
  );

  // Re-fetch in case ON CONFLICT skipped our insert (parallel worker raced us via the partial unique index).
  const reread = await client.query<{ id: string }>(
    `SELECT id FROM labels WHERE type = 'object' AND LOWER(scientific_name) = LOWER($1) LIMIT 1`,
    [scientificName],
  );
  const resolvedId = reread.rows[0]?.id ?? labelId;

  const displayName = commonName ?? scientificName;
  await client.query(
    `INSERT INTO label_translations (id, label_id, locale, name, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, 'en', $3, NOW(), NOW(), $4, $4)
     ON CONFLICT DO NOTHING`,
    [uuidv7(), resolvedId, displayName, userId],
  );

  return resolvedId;
}

async function resolvePlantMatterMaterialId(client: PoolClient): Promise<string | null> {
  const row = await client.query<{ id: string }>(
    `SELECT l.id FROM labels l
     JOIN label_translations lt ON lt.label_id = l.id
     WHERE l.type = 'material' AND lt.locale = 'en' AND LOWER(lt.name) = LOWER($1)
     LIMIT 1`,
    [PLANT_MATTER_MATERIAL_NAME],
  );
  return row.rows[0]?.id ?? null;
}

export async function persistPlantIdentification(
  client: PoolClient,
  spotId: string,
  userId: string,
  result: PlantIdentificationResult,
): Promise<void> {
  await client.query(`DELETE FROM detected_items WHERE spot_id = $1`, [spotId]);

  if (result.scientificName) {
    const objectLabelId = await resolveSpeciesLabel(
      client,
      result.scientificName,
      result.commonName,
      userId,
    );
    const materialLabelId = await resolvePlantMatterMaterialId(client);

    await client.query(
      `INSERT INTO detected_items (
         id, created_at, updated_at, created_by, updated_by,
         spot_id, object_label_id, material_label_id, brand_label_id,
         weight_grams, confidence, source_model
       ) VALUES ($1, NOW(), NOW(), $2, $2,
         $3, $4, $5, NULL,
         NULL, $6, $7)`,
      [uuidv7(), userId, spotId, objectLabelId, materialLabelId, result.confidence, result.source],
    );
  }

  await client.query(
    `UPDATE spots
     SET processing_status = $4,
         detection_completed_at = NOW(),
         processing_error = NULL,
         detection_raw = $1::jsonb,
         updated_at = NOW(),
         updated_by = $2
     WHERE id = $3`,
    [
      JSON.stringify({
        scientificName: result.scientificName,
        commonName: result.commonName,
        confidence: result.confidence,
        source: result.source,
      }),
      userId,
      spotId,
      PROCESSING_STATUS.COMPLETED,
    ],
  );
}
