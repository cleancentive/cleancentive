/**
 * What the worker and the API tell each other, and the public, about a spot
 * changing. Published on Redis by whoever made the change; the API clears its
 * insights cache on every one and streams them to subscribers over SSE.
 *
 * The payload is public. It carries only what `/insights/map` already shows
 * to anyone: never a user id.
 */
export const SPOT_EVENTS_CHANNEL = 'cleancentive:events';

export type SpotEventType = 'spot.created' | 'spot.completed' | 'spot.deleted';

export interface SpotEventItems {
  count: number;
  totalWeightGrams: number;
  /** English label of the heaviest detected object, if any. */
  topObject: string | null;
}

export interface SpotEvent {
  type: SpotEventType;
  spotId: string;
  teamId: string | null;
  cleanupId: string | null;
  cleanupDateId: string | null;
  capturedAt: string;
  latitude: number;
  longitude: number;
  pickedUp: boolean;
  subjectKind: 'litter' | 'plant';
  /** Present on `spot.completed` only. */
  items?: SpotEventItems;
  emittedAt: string;
}
