// Deterministic id minting.
//
// Every id is a uuidv5 derived from a committed root namespace + per-entity-type
// namespace + a layer-scoped logical key. The same logical key always yields the
// same uuid, so re-generating + merge-importing a layer never creates duplicate
// logical rows. FKs compose by minting child ids from parent logical keys.

import { v5 as uuidv5 } from 'uuid';

// Committed root namespace. DO NOT CHANGE — changing it re-keys every synthetic
// row and breaks idempotent re-application against existing bundles/databases.
const ROOT_NS = '7c5d2a1e-9b3f-5e84-a6c7-1f2e3d4c5b6a';

export type EntityType =
  | 'user'
  | 'user_email'
  | 'admin'
  | 'team'
  | 'team_membership'
  | 'team_message'
  | 'team_email_pattern'
  | 'cleanup'
  | 'cleanup_date'
  | 'cleanup_participant'
  | 'cleanup_message'
  | 'spot'
  | 'detected_item'
  | 'spot_edit'
  | 'pick_session'
  | 'label'
  | 'label_translation'
  | 'feedback'
  | 'feedback_response';

const typeNs = new Map<EntityType, string>();

function nsFor(type: EntityType): string {
  let ns = typeNs.get(type);
  if (!ns) {
    ns = uuidv5(type, ROOT_NS);
    typeNs.set(type, ns);
  }
  return ns;
}

export function mintId(type: EntityType, logicalKey: string): string {
  return uuidv5(logicalKey, nsFor(type));
}

// Human-traceable, stable upload id derived from the spot id (column is UNIQUE).
export function uploadIdFor(spotId: string): string {
  return `synthetic-${spotId.replace(/-/g, '').slice(0, 24)}`;
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
