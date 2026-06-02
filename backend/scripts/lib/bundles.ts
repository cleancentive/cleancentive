// Shared helpers for the data-bundle tooling (db-export / db-import / generate-synthetic).
//
// Centralises the things export and import must agree on for the default folder +
// incremental workflow: repo-root path anchoring, the default `data/` location, bundle
// naming, the v2 manifest shape, per-table watermark columns, and chain discovery.
//
// NOTE: SCOPE_GROUPS / TABLE_ORDER are intentionally NOT here — they stay duplicated in
// db-export.ts and db-import.ts (kept identical by hand, per the comment in those files).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

// This file lives at backend/scripts/lib/, so the repo root is three levels up.
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Default folder for bundles (git-ignored). Anchored at the repo root so it is stable
// regardless of the process cwd (the root `data:*` aliases run with cwd = backend/).
export const DATA_DIR = join(REPO_ROOT, 'data');

// Resolve a user-supplied path. Absolute paths pass through; relative paths anchor at the
// repo root (NOT process.cwd()) so `--output data/x` means the same thing whether invoked
// via the root `data:*` alias (cwd backend/) or directly. This is the cwd-gotcha fix.
export function resolvePath(p: string): string {
  return isAbsolute(p) ? p : join(REPO_ROOT, p);
}

// A short, filesystem-safe label for the source database host.
export function sourceLabel(host: string): string {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local';
  return host.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'remote';
}

export type BundleType = 'full' | 'incremental';

// Build a sortable bundle directory name: <source>-YYYYMMDD-HHMMSS-<full|incr>.
// `watermark` is a Postgres `now()::timestamp` string like "2026-05-30 16:45:12.123456".
export function bundleId(label: string, watermark: string, type: BundleType): string {
  const digits = watermark.replace(/\D/g, ''); // 20260530164512123456...
  const stamp = `${digits.slice(0, 8)}-${digits.slice(8, 14)}`; // YYYYMMDD-HHMMSS
  return `${label}-${stamp}-${type === 'full' ? 'full' : 'incr'}`;
}

// Per-table column to use as the incremental watermark. Most tables track real changes via
// updated_at; the two append-only audit tables only have created_at (rows are never updated).
export const WATERMARK_COLUMN: Record<string, 'updated_at' | 'created_at'> = {
  labels: 'updated_at',
  label_translations: 'updated_at',
  users: 'updated_at',
  user_emails: 'updated_at',
  admins: 'updated_at',
  teams: 'updated_at',
  team_email_patterns: 'updated_at',
  team_memberships: 'updated_at',
  team_messages: 'updated_at',
  cleanups: 'updated_at',
  cleanup_dates: 'updated_at',
  cleanup_participants: 'updated_at',
  cleanup_messages: 'updated_at',
  spots: 'updated_at',
  detected_items: 'updated_at',
  detected_item_edits: 'created_at',
  spot_edits: 'created_at',
  feedback: 'updated_at',
  feedback_responses: 'updated_at',
};

export interface BundleManifest {
  version: number; // 1 (legacy) or 2
  exported_at: string;
  source_database: string;
  source_host: string;
  scope: string[];
  tables: Record<string, { row_count: number }>;
  images?: { downloaded: number; failed: number; skipped: boolean };
  // v2 incremental fields:
  type?: BundleType;
  bundle_id?: string;
  source_label?: string;
  since?: string | null;
  high_watermark?: string;
  parent?: string | null;
}

export interface DiscoveredBundle {
  id: string;
  dir: string;
  manifest: BundleManifest;
}

// List every subdirectory of `root` that contains a manifest.json.
export function discoverBundles(root: string): DiscoveredBundle[] {
  if (!existsSync(root)) return [];
  const bundles: DiscoveredBundle[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest;
      bundles.push({ id: entry.name, dir, manifest });
    } catch {
      // skip unreadable/partial bundles
    }
  }
  return bundles;
}

function sameScope(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((v, i) => v === sortedB[i]);
}

// The most recent v2 bundle eligible to seed an incremental export: same source + identical
// scope + a recorded high_watermark. Returns null if none (caller falls back to a full).
export function findBase(
  bundles: DiscoveredBundle[],
  opts: { sourceLabel: string; scope: string[] },
): DiscoveredBundle | null {
  const eligible = bundles.filter(
    (b) =>
      b.manifest.version === 2 &&
      b.manifest.source_label === opts.sourceLabel &&
      typeof b.manifest.high_watermark === 'string' &&
      sameScope(b.manifest.scope, opts.scope),
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => (a.manifest.high_watermark! < b.manifest.high_watermark! ? 1 : -1));
  return eligible[0];
}

// The ordered restore chain for a source: the most recent full, then every increment taken
// after it (by high_watermark). Increments are additive, so time order is sufficient.
export function resolveChain(
  bundles: DiscoveredBundle[],
  opts: { sourceLabel: string },
): DiscoveredBundle[] {
  const forSource = bundles.filter(
    (b) => b.manifest.version === 2 && b.manifest.source_label === opts.sourceLabel,
  );
  const fulls = forSource
    .filter((b) => b.manifest.type === 'full')
    .sort((a, b) => (a.manifest.high_watermark! < b.manifest.high_watermark! ? 1 : -1));
  if (fulls.length === 0) return [];
  const base = fulls[0];
  const increments = forSource
    .filter(
      (b) =>
        b.manifest.type === 'incremental' &&
        typeof b.manifest.high_watermark === 'string' &&
        b.manifest.high_watermark! > base.manifest.high_watermark!,
    )
    .sort((a, b) => (a.manifest.high_watermark! < b.manifest.high_watermark! ? -1 : 1));
  return [base, ...increments];
}

// Distinct source labels present in the bundle set (for chain restore when --source is omitted).
export function sourceLabels(bundles: DiscoveredBundle[]): string[] {
  return [...new Set(bundles.map((b) => b.manifest.source_label).filter((s): s is string => Boolean(s)))];
}
