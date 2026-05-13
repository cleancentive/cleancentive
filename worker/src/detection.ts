import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { PROCESSING_STATUS } from '@cleancentive/shared';
import type { DetectionResult, DetectedObject } from '@cleancentive/shared';

export type LabelType = 'object' | 'material' | 'brand';

export interface LabelRequest {
  type: LabelType;
  enName: string;
}

function labelKey(type: LabelType, enName: string): string {
  return `${type}:${enName.toLowerCase()}`;
}

function titleCase(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

function uniqueLabelRequests(objects: DetectedObject[]): LabelRequest[] {
  const seen = new Map<string, LabelRequest>();
  for (const obj of objects) {
    if (obj.category) seen.set(labelKey('object', obj.category), { type: 'object', enName: obj.category });
    if (obj.material) seen.set(labelKey('material', obj.material), { type: 'material', enName: obj.material });
    if (obj.brand) seen.set(labelKey('brand', obj.brand), { type: 'brand', enName: obj.brand });
  }
  return Array.from(seen.values());
}

export async function batchResolveLabels(
  client: PoolClient,
  requests: LabelRequest[],
  userId: string,
): Promise<Map<string, string>> {
  const labelIdMap = new Map<string, string>();
  if (requests.length === 0) return labelIdMap;

  const queryParams: string[] = [];
  for (const req of requests) {
    queryParams.push(req.type, req.enName.toLowerCase());
  }
  const conditions = requests
    .map((_, i) => `(l.type = $${i * 2 + 1} AND LOWER(lt.name) = $${i * 2 + 2})`)
    .join(' OR ');

  const existing = await client.query<{ id: string; type: LabelType; lower_name: string }>(
    `SELECT l.id, l.type, LOWER(lt.name) AS lower_name
     FROM labels l
     JOIN label_translations lt ON lt.label_id = l.id
     WHERE lt.locale = 'en' AND (${conditions})`,
    queryParams,
  );

  for (const row of existing.rows) {
    labelIdMap.set(labelKey(row.type, row.lower_name), row.id);
  }

  const missing = requests.filter((req) => !labelIdMap.has(labelKey(req.type, req.enName)));
  for (const req of missing) {
    const labelId = uuidv7();
    const translationId = uuidv7();
    await client.query(
      `INSERT INTO labels (id, type, created_at, updated_at, created_by, updated_by) VALUES ($1, $2, NOW(), NOW(), $3, $3)
       ON CONFLICT DO NOTHING`,
      [labelId, req.type, userId],
    );
    await client.query(
      `INSERT INTO label_translations (id, label_id, locale, name, created_at, updated_at, created_by, updated_by) VALUES ($1, $2, 'en', $3, NOW(), NOW(), $4, $4)
       ON CONFLICT DO NOTHING`,
      [translationId, labelId, titleCase(req.enName), userId],
    );
    // Re-fetch in case ON CONFLICT skipped our insert because a parallel worker created it first.
    const reread = await client.query<{ id: string }>(
      `SELECT l.id FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       WHERE l.type = $1 AND lt.locale = 'en' AND LOWER(lt.name) = LOWER($2)
       LIMIT 1`,
      [req.type, req.enName],
    );
    if (reread.rows[0]) {
      labelIdMap.set(labelKey(req.type, req.enName), reread.rows[0].id);
    }
  }

  return labelIdMap;
}

export async function insertDetectedItems(
  client: PoolClient,
  spotId: string,
  objects: DetectedObject[],
  labelIdMap: Map<string, string>,
  model: string,
  userId: string,
): Promise<void> {
  if (objects.length === 0) return;

  const labelIdOrNull = (type: LabelType, name: string | null): string | null => {
    if (!name) return null;
    return labelIdMap.get(labelKey(type, name)) ?? null;
  };

  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const object of objects) {
    values.push(
      `($${p++}, NOW(), NOW(), $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
    );
    params.push(
      uuidv7(),
      userId,
      userId,
      spotId,
      labelIdOrNull('object', object.category),
      labelIdOrNull('material', object.material),
      labelIdOrNull('brand', object.brand),
      object.weightGrams,
      object.confidence,
      model,
    );
  }

  await client.query(
    `INSERT INTO detected_items (
       id, created_at, updated_at, created_by, updated_by,
       spot_id, object_label_id, material_label_id, brand_label_id,
       weight_grams, confidence, source_model
     ) VALUES ${values.join(', ')}`,
    params,
  );
}

export async function updateSpotCompletion(
  client: PoolClient,
  spotId: string,
  userId: string,
  detectionRaw: { objects: DetectedObject[]; notes: string | null; model: string },
): Promise<void> {
  await client.query(
    `UPDATE spots
     SET processing_status = $4,
         detection_completed_at = NOW(),
         processing_error = NULL,
         detection_raw = $1::jsonb,
         updated_at = NOW(),
         updated_by = $2
     WHERE id = $3`,
    [JSON.stringify(detectionRaw), userId, spotId, PROCESSING_STATUS.COMPLETED],
  );
}

export async function persistDetection(
  client: PoolClient,
  spotId: string,
  userId: string,
  detection: DetectionResult,
  model: string,
): Promise<void> {
  await client.query(`DELETE FROM detected_items WHERE spot_id = $1`, [spotId]);

  const labelRequests = uniqueLabelRequests(detection.objects);
  const labelIdMap = await batchResolveLabels(client, labelRequests, userId);

  await insertDetectedItems(client, spotId, detection.objects, labelIdMap, model, userId);

  await updateSpotCompletion(client, spotId, userId, {
    objects: detection.objects,
    notes: detection.notes,
    model,
  });
}
