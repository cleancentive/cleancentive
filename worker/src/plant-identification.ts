import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { PROCESSING_STATUS } from '@cleancentive/shared';
import type { PlantIdentificationResult } from './identifiers/types';
import { lookupInvasive } from './infoflora';

export async function persistPlantIdentification(
  client: PoolClient,
  spotId: string,
  userId: string,
  result: PlantIdentificationResult,
): Promise<void> {
  await client.query(`DELETE FROM plant_identifications WHERE spot_id = $1`, [spotId]);

  if (result.scientificName) {
    const invasive = lookupInvasive(result.scientificName);
    await client.query(
      `INSERT INTO plant_identifications (
         id, created_at, updated_at, created_by, updated_by,
         spot_id, scientific_name, common_name_en, confidence,
         identification_source, identification_raw,
         is_invasive, invasive_list, recommended_action, human_verified
       ) VALUES ($1, NOW(), NOW(), $2, $2,
         $3, $4, $5, $6,
         $7, $8::jsonb,
         $9, $10, $11, false)`,
      [
        uuidv7(),
        userId,
        spotId,
        result.scientificName,
        result.commonName ?? invasive?.commonNameEn ?? null,
        result.confidence,
        result.source,
        JSON.stringify(result.raw ?? null),
        invasive !== null,
        invasive?.list ?? null,
        invasive?.recommendedAction ?? null,
      ],
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
