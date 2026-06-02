// Layered synthetic data generator.
//
// Emits an import bundle in the exact db-export format (<table>.ndjson +
// manifest.json + images/<s3-key>) from a deterministic LayerSpec, then load it
// with `db-import --mode merge`. Generation never touches the DB or S3 — it only
// writes files — and is fully deterministic, so re-applying a layer is idempotent.
//
// Usage:
//   bun run scripts/generate-synthetic.ts --output <dir> [flags]
// See --help for all flags. Compose worlds by generating multiple layers with
// distinct --layer-id values and importing them in sequence (merge mode).

import { join } from 'node:path';
import { DATA_DIR, resolvePath } from './lib/bundles';
import {
  type LayerSpec,
  loadSpec,
  defaultBaseSpec,
  validateSpec,
  CITY_BOXES,
} from './synthetic/spec';
import { loadTaco } from './synthetic/taco';
import { resolverFromExport, resolverEmitFromSeed, type LabelResolver } from './synthetic/labels';
import { BundleWriter, type BundleManifest } from './synthetic/bundle';
import { buildWorld } from './synthetic/world';

const DEFAULT_TACO_PATH = '/Users/matthias/git/TACO';
// Resolve the seed file relative to this script (backend/scripts/), so the path
// holds regardless of the caller's cwd (root `data:*` alias vs. backend `db:*`).
const SEED_LABELS_PATH = join(__dirname, '..', 'src', 'label', 'seed', 'labels.json');

// Mirror of db-export.ts SCOPE_GROUPS — used to derive the manifest `scope`.
const TABLE_TO_GROUP: Record<string, string> = {
  labels: 'labels',
  label_translations: 'labels',
  users: 'users',
  user_emails: 'users',
  admins: 'users',
  teams: 'teams',
  team_email_patterns: 'teams',
  team_memberships: 'teams',
  team_messages: 'teams',
  cleanups: 'cleanups',
  cleanup_dates: 'cleanups',
  cleanup_participants: 'cleanups',
  cleanup_messages: 'cleanups',
  spots: 'spots',
  detected_items: 'spots',
  detected_item_edits: 'spots',
  spot_edits: 'spots',
  feedback: 'feedback',
  feedback_responses: 'feedback',
};
const GROUP_ORDER = ['labels', 'users', 'teams', 'cleanups', 'spots', 'feedback'];

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

function printUsage(): void {
  console.log('Usage: bun run scripts/generate-synthetic.ts --output <dir>');
  console.log('');
  console.log('Flags:');
  console.log('  --output <dir>        Target bundle dir (default: data/synthetic-<layerId>)');
  console.log('  --spec <file>         Layer spec JSON (default: built-in Basel base world)');
  console.log('  --seed <n>            Override the spec seed');
  console.log('  --layer-id <slug>     Override the spec layerId (namespaces all ids)');
  console.log('  --users <n>           Override user count');
  console.log('  --spots <n>           Override spot count');
  console.log('  --window <start:end>  Override window, e.g. 2024-12-01:2026-05-25');
  console.log(`  --taco-path <dir>     TACO dataset root (default: ${DEFAULT_TACO_PATH})`);
  console.log('  --downscale <px>      Downscale originals to max <px> (default: copy verbatim)');
  console.log('  --labels-from <dir>   Resolve label ids from a `db:export --scope labels` bundle');
  console.log('                        (recommended when importing onto a seeded DB)');
  console.log('  --labels emit         Emit labels from the seed file with deterministic ids');
  console.log('                        (default; self-contained, for an empty DB)');
  console.log('  --no-images           Skip writing image files (rows still reference keys)');
  console.log('  --dry-run             Print the resolved plan and exit without writing');
  console.log('  --help                Show this help');
}

function resolveSpec(): LayerSpec {
  const specFile = getArgValue('--spec');
  const spec = specFile ? loadSpec(resolvePath(specFile)) : defaultBaseSpec();

  const seed = getArgValue('--seed');
  if (seed !== null) spec.seed = parseInt(seed, 10);

  const layerId = getArgValue('--layer-id');
  if (layerId !== null) spec.layerId = layerId;

  const users = getArgValue('--users');
  if (users !== null) spec.counts.users = parseInt(users, 10);

  const spots = getArgValue('--spots');
  if (spots !== null) spec.counts.spots = parseInt(spots, 10);

  const windowArg = getArgValue('--window');
  if (windowArg !== null) {
    const [start, end] = windowArg.split(':');
    spec.window = { start, end };
  }

  const downscale = getArgValue('--downscale');
  if (downscale !== null) {
    spec.taco = { ...(spec.taco ?? {}), downscaleMaxPx: parseInt(downscale, 10) };
  }

  // Backfill known city boxes if a spec referenced a city by name only.
  for (const city of spec.cities) {
    if (!city.box && CITY_BOXES[city.name]) city.box = CITY_BOXES[city.name];
  }

  validateSpec(spec);
  return spec;
}

function buildResolver(): LabelResolver {
  const labelsFrom = getArgValue('--labels-from');
  if (labelsFrom) return resolverFromExport(resolvePath(labelsFrom));

  const labelsMode = getArgValue('--labels');
  if (labelsMode && labelsMode !== 'emit') {
    console.error(`Invalid --labels value: ${labelsMode}. Use 'emit' or pass --labels-from <dir>.`);
    process.exit(1);
  }
  if (!labelsMode) {
    console.log(
      'Warning: no --labels-from given — emitting labels with deterministic ids. ' +
        'When importing onto a DB that already seeded labels, pass --labels-from <labels-export> ' +
        'to avoid duplicate label rows.',
    );
  }
  return resolverEmitFromSeed(SEED_LABELS_PATH);
}

async function main(): Promise<void> {
  if (hasArg('--help')) {
    printUsage();
    return;
  }

  const spec = resolveSpec();
  const outputArg = getArgValue('--output');
  const outputDir = outputArg ? resolvePath(outputArg) : join(DATA_DIR, `synthetic-${spec.layerId}`);
  const noImages = hasArg('--no-images');
  const tacoPath = getArgValue('--taco-path') || DEFAULT_TACO_PATH;
  const downscaleMaxPx = spec.taco?.downscaleMaxPx ?? null;

  const taco = loadTaco(tacoPath, spec.taco?.maxImages);

  console.log(`Layer: ${spec.layerId} (${spec.scenarioType}), seed ${spec.seed}`);
  console.log(`Window: ${spec.window.start} → ${spec.window.end}`);
  console.log(`Cities: ${spec.cities.map((c) => `${c.name}(${c.weight})`).join(', ')}`);
  console.log(`Plan: ${spec.counts.users} users, ${spec.teams.length} teams, ${spec.cleanups.length} cleanups, ${spec.counts.spots} spots`);
  console.log(`TACO images available on disk: ${taco.length}`);

  if (hasArg('--dry-run')) {
    console.log('');
    console.log('Dry run — no files written.');
    return;
  }

  const resolver = buildResolver();
  const writer = new BundleWriter(outputDir);
  await writer.init();

  const stats = await buildWorld({
    spec,
    resolver,
    taco,
    writer,
    imagesRoot: join(outputDir, 'images'),
    noImages,
    downscaleMaxPx,
    log: (msg) => console.log(`  ${msg}`),
  });

  // Build manifest in the db-export shape.
  const tables: Record<string, { row_count: number }> = {};
  const scopeSet = new Set<string>();
  for (const table of writer.tablesWritten()) {
    tables[table] = { row_count: writer.rowCount(table) };
    const group = TABLE_TO_GROUP[table];
    if (group) scopeSet.add(group);
  }
  const scope = GROUP_ORDER.filter((g) => scopeSet.has(g));

  const manifest: BundleManifest = {
    version: 1,
    exported_at: new Date(Date.parse(spec.window.end)).toISOString(), // deterministic
    source_database: 'synthetic',
    source_host: `synthetic:${spec.layerId}`,
    scope,
    tables,
    images: { downloaded: stats.imagesWritten, failed: 0, skipped: noImages },
  };

  await writer.finalize(manifest);

  console.log('');
  console.log(`Bundle written → ${outputDir}`);
  console.log(`  Scope: ${scope.join(', ')}`);
  console.log(`  Tables: ${Object.keys(tables).length}`);
  console.log(`  Total rows: ${Object.values(tables).reduce((sum, t) => sum + t.row_count, 0)}`);
  console.log(`  Image files: ${stats.imagesWritten}${noImages ? ' (skipped)' : ''}`);
  console.log('');
  console.log(`Import with: bun run scripts/db-import.ts --input ${outputDir} --mode merge`);
}

main().catch((error) => {
  console.error('Generation failed:', error);
  process.exit(1);
});
