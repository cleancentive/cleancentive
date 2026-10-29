// Shared helpers for the data-bundle tooling (db-export / db-import / generate-synthetic).
//
// A bundle is a folder of `<table>.ndjson` files, a `manifest.json` and `images/<s3-key>`.
// The default export keeps one bundle per source (`data/<source>/`) and updates it in
// place: it compares a hash of every row with the hashes from the previous run, fetches
// only new and changed rows, archives rows that vanished, and downloads only images that
// are not on disk yet. The pure parts of that sync live here so they can be tested.
//
// NOTE: SCOPE_GROUPS / TABLE_ORDER are intentionally NOT here — they stay duplicated in
// db-export.ts and db-import.ts (kept identical by hand, per the comment in those files).

import { isAbsolute, join, resolve } from 'node:path';

// This file lives at backend/scripts/lib/, so the repo root is three levels up.
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Default folder for bundles (git-ignored). Anchored at the repo root so it is stable
// regardless of the process cwd (the root `data:*` aliases run with cwd = backend/).
export const DATA_DIR = join(REPO_ROOT, 'data');

// Files and folders inside a mirror that are bookkeeping, not data to restore.
export const SYNC_STATE_DIR = '.sync';
export const SYNC_LOG_FILE = 'sync-log.ndjson';
export const DELETED_DIR = 'deleted';
export const DELETED_IMAGES_DIR = '.deleted';

// Resolve a user-supplied path. Absolute paths pass through; relative paths anchor at the
// repo root (NOT process.cwd()) so `--output data/x` means the same thing whether invoked
// via the root `data:*` alias (cwd backend/) or directly.
export function resolvePath(p: string): string {
  return isAbsolute(p) ? p : join(REPO_ROOT, p);
}

// A short, filesystem-safe label for the source database host. Over an SSH tunnel the
// host is 127.0.0.1, so a production mirror must be named explicitly with --source.
export function sourceLabel(host: string): string {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local';
  return safeLabel(host) || 'remote';
}

export function safeLabel(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export interface BundleManifest {
  version: number; // 1, 2 (legacy full/incremental) or 3 (mirror / snapshot)
  exported_at: string;
  source_database: string;
  source_host: string;
  scope: string[];
  tables: Record<string, { row_count: number }>;
  images?: {
    downloaded: number;
    failed: number;
    skipped: boolean;
    on_disk?: number;
    pending?: number;
    cap_exceeded?: boolean;
  };
  type?: 'full' | 'incremental' | 'mirror';
  bundle_id?: string;
  source_label?: string;
  since?: string | null;
  high_watermark?: string;
  parent?: string | null;
}

export type Row = Record<string, unknown>;

/**
 * The identity of a row as a string. Primary-key values come from the database as text
 * (the hash query selects them `::text`), so a local row's key is built the same way:
 * one column → its value, several → a JSON array of the values.
 */
export function rowKey(row: Row, pkColumns: string[]): string {
  if (pkColumns.length === 1) return String(row[pkColumns[0]]);
  return JSON.stringify(pkColumns.map((c) => String(row[c])));
}

export interface TableSyncPlan {
  /** Keys whose full rows must be fetched: new on the source, changed, or missing locally. */
  fetch: string[];
  /** Keys present locally that the source no longer has. */
  remove: string[];
}

/**
 * Decide what one table needs. Without previous hashes (first run, or a bundle taken by
 * an older export) every row is fetched once; after that only rows whose hash moved.
 */
export function planTableSync(
  localKeys: Set<string>,
  previousHashes: Record<string, string> | undefined,
  currentHashes: Record<string, string>,
): TableSyncPlan {
  const fetch: string[] = [];
  for (const [key, hash] of Object.entries(currentHashes)) {
    if (!localKeys.has(key) || !previousHashes || previousHashes[key] !== hash) fetch.push(key);
  }
  const remove = [...localKeys].filter((key) => !(key in currentHashes));
  return { fetch, remove };
}

export interface MergeResult {
  rows: Row[];
  removed: Row[];
  stats: { added: number; updated: number; unchanged: number; deleted: number };
}

/**
 * Apply fetched rows and removals to a table's local rows. Output is sorted by key so the
 * ndjson files diff cleanly between runs. A refetched row identical to the local one
 * counts as unchanged (that is what a first run over an existing bundle looks like).
 */
export function mergeRows(existing: Row[], fetched: Row[], remove: Set<string>, keyOf: (row: Row) => string): MergeResult {
  const byKey = new Map<string, Row>();
  for (const row of existing) byKey.set(keyOf(row), row);

  const stats = { added: 0, updated: 0, unchanged: 0, deleted: 0 };
  const removed: Row[] = [];
  for (const key of remove) {
    const row = byKey.get(key);
    if (!row) continue;
    removed.push(row);
    byKey.delete(key);
    stats.deleted++;
  }
  for (const row of fetched) {
    const key = keyOf(row);
    const before = byKey.get(key);
    if (!before) stats.added++;
    else if (JSON.stringify(before) === JSON.stringify(row)) stats.unchanged++;
    else stats.updated++;
    byKey.set(key, row);
  }

  const rows = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
  return { rows, removed, stats };
}

/** Every S3 key the live spots reference (originals and thumbnails). */
export function referencedImageKeys(spots: Row[]): Set<string> {
  const keys = new Set<string>();
  for (const spot of spots) {
    for (const column of ['image_key', 'thumbnail_key']) {
      const key = spot[column];
      if (typeof key === 'string' && key.length > 0) keys.add(key);
    }
  }
  return keys;
}

/** Images to download (referenced, not on disk) and images to archive (on disk, no longer referenced). */
export function planImageSync(referenced: Set<string>, onDisk: Set<string>): { download: string[]; orphaned: string[] } {
  return {
    download: [...referenced].filter((key) => !onDisk.has(key)).sort(),
    orphaned: [...onDisk].filter((key) => !referenced.has(key)).sort(),
  };
}

/**
 * Backblaze answers with this once the account's daily download or Class B cap is used up.
 * Every further request fails the same way until the cap resets, so the export stops
 * instead of burning one failing request per remaining object.
 */
export function isCapExceeded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cap exceeded|download bandwidth or transaction/i.test(message);
}
