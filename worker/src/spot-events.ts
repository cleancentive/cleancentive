import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { SPOT_EVENTS_CHANNEL, type SpotEvent } from '@cleancentive/shared';

interface CompletedSpotRow {
  team_id: string | null;
  cleanup_id: string | null;
  cleanup_date_id: string | null;
  captured_at: Date;
  latitude: number;
  longitude: number;
  picked_up: boolean;
  subject_kind: 'litter' | 'plant';
  item_count: number;
  total_weight_grams: number | string | null;
  top_object: string | null;
}

/**
 * The `spot.completed` event for a spot whose detection results were just
 * persisted, read back from the database so the payload reflects what was
 * actually stored. Null when the spot is gone, which happens when it was
 * deleted while its job was running.
 */
export async function loadCompletedSpotEvent(db: Pick<Pool, 'query'>, spotId: string): Promise<SpotEvent | null> {
  const { rows } = await db.query<CompletedSpotRow>(
    `SELECT s.team_id, s.cleanup_id, s.cleanup_date_id, s.captured_at, s.latitude, s.longitude,
            s.picked_up, s.subject_kind,
            (SELECT COUNT(*)::int FROM detected_items di WHERE di.spot_id = s.id) AS item_count,
            (SELECT COALESCE(SUM(di.weight_grams), 0) FROM detected_items di WHERE di.spot_id = s.id) AS total_weight_grams,
            (SELECT lt.name
               FROM detected_items di
               JOIN label_translations lt ON lt.label_id = di.object_label_id AND lt.locale = 'en'
              WHERE di.spot_id = s.id
              ORDER BY di.weight_grams DESC NULLS LAST
              LIMIT 1) AS top_object
       FROM spots s
      WHERE s.id = $1`,
    [spotId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    type: 'spot.completed',
    spotId,
    teamId: row.team_id,
    cleanupId: row.cleanup_id,
    cleanupDateId: row.cleanup_date_id,
    capturedAt: new Date(row.captured_at).toISOString(),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    pickedUp: row.picked_up,
    subjectKind: row.subject_kind,
    items: {
      count: Number(row.item_count),
      totalWeightGrams: Number(row.total_weight_grams ?? 0),
      topObject: row.top_object,
    },
    emittedAt: new Date().toISOString(),
  };
}

export async function publishSpotEvent(redis: Pick<Redis, 'publish'>, event: SpotEvent): Promise<void> {
  await redis.publish(SPOT_EVENTS_CHANNEL, JSON.stringify(event));
}
