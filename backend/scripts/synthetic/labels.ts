// Label id resolution.
//
// The generator is file-only and cannot query the database. Labels are seeded at
// app bootstrap (backend/src/label/seed/labels.json) with uuidv7 ids, so to
// reference REAL label ids we read a `db:export --scope labels` bundle. Two modes:
//
//   from <dir>  (default, safe for a seeded DB): map (type, en-name) → real id,
//               emit no label rows.
//   emit        (self-contained, empty DB): emit labels + label_translations with
//               deterministic v5 ids. NOTE: importing this via merge onto a DB that
//               already seeded labels (v7 ids) can create duplicate label rows
//               (the bootstrap seeder dedupes by name, not id).
//
// Either way, detected_items also carry label NAMES in detection_raw, so spot data
// stays meaningful even when a label id resolves to null.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mintId } from './ids';

export type LabelType = 'object' | 'material' | 'brand';

export interface LabelResolver {
  idFor(type: LabelType, name: string | null): string | null;
  labelRows: Record<string, unknown>[];
  translationRows: Record<string, unknown>[];
}

interface SeedLabel {
  type: LabelType;
  scientific_name?: string;
  translations: Record<string, string>;
}

const SEED_TS = '2024-01-01T00:00:00.000Z';

function key(type: string, name: string): string {
  return `${type}:${name.toLowerCase()}`;
}

function readNdjson(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function resolverFromExport(dir: string): LabelResolver {
  const labels = readNdjson(join(dir, 'labels.ndjson'));
  const translations = readNdjson(join(dir, 'label_translations.ndjson'));

  const enNameByLabel = new Map<string, string>();
  for (const t of translations) {
    if (t.locale === 'en') enNameByLabel.set(String(t.label_id), String(t.name));
  }

  const map = new Map<string, string>();
  for (const l of labels) {
    const en = enNameByLabel.get(String(l.id));
    if (en) map.set(key(String(l.type), en), String(l.id));
  }

  return {
    idFor: (type, name) => (name ? map.get(key(type, name)) ?? null : null),
    labelRows: [],
    translationRows: [],
  };
}

export function resolverEmitFromSeed(seedJsonPath: string): LabelResolver {
  const seed = JSON.parse(readFileSync(seedJsonPath, 'utf8')) as SeedLabel[];
  const map = new Map<string, string>();
  const labelRows: Record<string, unknown>[] = [];
  const translationRows: Record<string, unknown>[] = [];

  for (const entry of seed) {
    const en = entry.translations.en;
    const labelId = mintId('label', key(entry.type, en));
    labelRows.push({
      id: labelId,
      type: entry.type,
      scientific_name: entry.scientific_name ?? null,
      created_at: SEED_TS,
      updated_at: SEED_TS,
      created_by: null,
      updated_by: null,
    });
    for (const [locale, name] of Object.entries(entry.translations)) {
      translationRows.push({
        id: mintId('label_translation', `${labelId}:${locale}`),
        label_id: labelId,
        locale,
        name,
        created_at: SEED_TS,
        updated_at: SEED_TS,
        created_by: null,
        updated_by: null,
      });
    }
    map.set(key(entry.type, en), labelId);
  }

  return {
    idFor: (type, name) => (name ? map.get(key(type, name)) ?? null : null),
    labelRows,
    translationRows,
  };
}
