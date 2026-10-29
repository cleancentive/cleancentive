import { appendFileSync, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { Client, types } from 'pg';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DATA_DIR,
  DELETED_DIR,
  DELETED_IMAGES_DIR,
  SYNC_LOG_FILE,
  SYNC_STATE_DIR,
  type BundleManifest,
  type Row,
  isCapExceeded,
  mergeRows,
  planImageSync,
  planTableSync,
  referencedImageKeys,
  resolvePath,
  rowKey,
  safeLabel,
  sourceLabel,
} from './lib/bundles';

// Preserve raw timestamp strings from Postgres (avoid JS Date precision loss)
types.setTypeParser(1114, (val) => val); // timestamp without timezone
types.setTypeParser(1184, (val) => val); // timestamp with timezone

type ScopeGroup = 'users' | 'teams' | 'cleanups' | 'spots' | 'labels' | 'feedback';

// NOTE: keep SCOPE_GROUPS and TABLE_ORDER identical to db-import.ts (duplicated by design).
const SCOPE_GROUPS: Record<ScopeGroup, string[]> = {
  labels: ['labels', 'label_translations'],
  users: ['users', 'user_emails', 'admins'],
  teams: ['teams', 'team_email_patterns', 'team_memberships', 'team_messages', 'cleanup_feeds'],
  cleanups: ['cleanups', 'cleanup_dates', 'cleanup_participants', 'cleanup_messages'],
  spots: ['spots', 'detected_items', 'detected_item_edits', 'spot_edits'],
  feedback: ['feedback', 'feedback_responses'],
};

const ALL_GROUPS: ScopeGroup[] = ['labels', 'users', 'teams', 'cleanups', 'spots', 'feedback'];

// Non-nullable FK dependencies between scope groups
const GROUP_DEPENDENCIES: Partial<Record<ScopeGroup, ScopeGroup[]>> = {
  teams: ['users'],
  cleanups: ['users'],
  spots: ['users'],
};

// Nullable FK references (warn but don't force)
const GROUP_SOFT_DEPENDENCIES: Partial<Record<ScopeGroup, ScopeGroup[]>> = {
  spots: ['teams', 'cleanups', 'labels'],
  detected_items: ['labels'],
} as Partial<Record<string, ScopeGroup[]>>;

// Tables in topological order for export
const TABLE_ORDER: string[] = [
  'labels',
  'label_translations',
  'users',
  'user_emails',
  'admins',
  'teams',
  'team_email_patterns',
  'team_memberships',
  'team_messages',
  'cleanup_feeds',
  'cleanups',
  'cleanup_dates',
  'cleanup_participants',
  'cleanup_messages',
  'spots',
  'detected_items',
  'detected_item_edits',
  'spot_edits',
  'feedback',
  'feedback_responses',
];

const FETCH_BATCH = 500;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_ATTEMPTS = 3;
/** Exit code when the image phase stopped on the object store's daily cap. */
const EXIT_CAP_EXCEEDED = 2;

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

function printUsage(): void {
  console.log('Usage: bun run scripts/db-export.ts [--source <name>] [--full --output <dir>]');
  console.log('');
  console.log('By default keeps one backup folder per source, data/<source>/, and updates it in');
  console.log('place: only new and changed rows are fetched, rows that vanished from the source');
  console.log('move to deleted/, and only images not yet on disk are downloaded.');
  console.log('');
  console.log('Flags:');
  console.log('  --source <name>     Name of the source and its folder (default: BACKUP_SOURCE, else');
  console.log('                      derived from DB_HOST — "local" for localhost, so pass');
  console.log('                      --source prod when exporting production over a tunnel)');
  console.log('  --output-root <dir> Folder that holds the per-source folders (default: data/)');
  console.log('  --output <dir>      Use exactly this folder instead of <root>/<source>');
  console.log('  --full              One-off snapshot: export everything into --output (required),');
  console.log('                      no sync state, no deleted archive');
  console.log('  --scope <groups>    Comma-separated scope groups (default: all; a folder keeps the');
  console.log('                      scope of its first run)');
  console.log('                      Groups: users, teams, cleanups, spots, labels, feedback, all');
  console.log('  --no-images         Skip S3 images');
  console.log('  --help              Show this help');
}

function resolveScope(scopeArg: string | null): { groups: ScopeGroup[]; expanded: ScopeGroup[]; warnings: string[] } {
  const warnings: string[] = [];

  let requested: ScopeGroup[];
  if (!scopeArg || scopeArg === 'all') {
    requested = [...ALL_GROUPS];
  } else {
    requested = scopeArg.split(',').map((s) => s.trim()) as ScopeGroup[];
    for (const g of requested) {
      if (!SCOPE_GROUPS[g]) {
        console.error(`Unknown scope group: ${g}`);
        console.error(`Valid groups: ${ALL_GROUPS.join(', ')}, all`);
        process.exit(1);
      }
    }
  }

  const expanded: ScopeGroup[] = [];
  const groupSet = new Set(requested);

  for (const group of requested) {
    const deps = GROUP_DEPENDENCIES[group];
    if (deps) {
      for (const dep of deps) {
        if (!groupSet.has(dep)) {
          groupSet.add(dep);
          expanded.push(dep);
        }
      }
    }
  }

  for (const group of requested) {
    const softDeps = (GROUP_SOFT_DEPENDENCIES as Record<string, ScopeGroup[]>)[group];
    if (softDeps) {
      for (const dep of softDeps) {
        if (!groupSet.has(dep)) {
          warnings.push(`'${group}' has nullable FK references to '${dep}' which is not in scope — some references may be dangling`);
        }
      }
    }
  }

  const groups = ALL_GROUPS.filter((g) => groupSet.has(g));
  return { groups, expanded, warnings };
}

function getTablesForGroups(groups: ScopeGroup[]): string[] {
  const tableSet = new Set<string>();
  for (const group of groups) {
    for (const table of SCOPE_GROUPS[group]) {
      tableSet.add(table);
    }
  }
  return TABLE_ORDER.filter((t) => tableSet.has(t));
}

function createDbClient(): Client {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'cleancentive',
    password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
    database: process.env.DB_DATABASE || 'cleancentive',
  });
}

function createS3Client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9002',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
  });
}

class CapExceededError extends Error {}

/**
 * Fetches one object into the bundle. A file already on disk is kept, so a
 * rerun resumes rather than restarts. Each attempt is bounded: an object
 * store that stops sending mid-stream used to hang the export forever — and
 * with nothing else keeping the event loop alive, Bun then exited 0 as if
 * the export had finished. A daily-cap answer throws CapExceededError at once:
 * every further request would fail the same way until the cap resets.
 */
async function downloadS3Object(s3Client: S3Client, bucket: string, key: string, outputDir: string): Promise<boolean> {
  const filePath = join(outputDir, 'images', key);
  await mkdir(dirname(filePath), { recursive: true });
  if (existsSync(filePath) && statSync(filePath).size > 0) return true;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: abort.signal });
      if (!response.Body) return false;
      await pipeline(response.Body as Readable, createWriteStream(filePath), { signal: abort.signal });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await rm(filePath, { force: true });
      if (isCapExceeded(error)) throw new CapExceededError(message);
      if (message.includes('NoSuchKey') || message.includes('The specified key does not exist')) return false;
      if (attempt === DOWNLOAD_ATTEMPTS) {
        console.warn(`  giving up on ${key} after ${DOWNLOAD_ATTEMPTS} attempts: ${message}`);
        return false;
      }
      console.warn(`  retrying ${key} (${attempt}/${DOWNLOAD_ATTEMPTS}): ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

interface ImageRunResult {
  downloaded: number;
  failed: number;
  pending: number;
  capExceeded: boolean;
}

/** Downloads `keys` in order, stopping on the first cap-exceeded answer. */
async function downloadImages(keys: string[], outputDir: string): Promise<ImageRunResult> {
  const s3Client = createS3Client();
  const bucket = process.env.S3_BUCKET || 'cleancentive-images';
  const result: ImageRunResult = { downloaded: 0, failed: 0, pending: 0, capExceeded: false };
  for (let i = 0; i < keys.length; i++) {
    try {
      if (await downloadS3Object(s3Client, bucket, keys[i], outputDir)) result.downloaded++;
      else result.failed++;
    } catch (error) {
      if (!(error instanceof CapExceededError)) throw error;
      result.capExceeded = true;
      result.pending = keys.length - i;
      console.warn(`  The object store's daily cap is used up: ${error.message}`);
      break;
    }
    if ((i + 1) % 250 === 0) console.log(`  … ${i + 1}/${keys.length}`);
  }
  return result;
}

async function readNdjson(filePath: string): Promise<Row[]> {
  if (!existsSync(filePath)) return [];
  const content = await Bun.file(filePath).text();
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function readJson<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await Bun.file(filePath).text()) as T;
}

/** Write via a temp file and rename, so a crash never leaves a half-written file behind. */
async function writeAtomically(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, filePath);
}

function toNdjson(rows: Row[]): string {
  return rows.map((row) => JSON.stringify(row) + '\n').join('');
}

async function primaryKeyColumns(db: Client, table: string): Promise<string[]> {
  const result = await db.query(
    `SELECT a.attname AS column
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    [`"${table}"`],
  );
  const columns = result.rows.map((r) => r.column as string);
  if (columns.length === 0) throw new Error(`Table ${table} has no primary key; it cannot be synced row by row.`);
  return columns;
}

async function fetchRowsByKey(db: Client, table: string, pk: string[], keys: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < keys.length; i += FETCH_BATCH) {
    const batch = keys.slice(i, i + FETCH_BATCH);
    if (pk.length === 1) {
      const result = await db.query(`SELECT * FROM "${table}" WHERE "${pk[0]}"::text = ANY($1::text[])`, [batch]);
      rows.push(...result.rows);
    } else {
      const tuples = batch.map((key) => JSON.parse(key) as string[]);
      const params = pk.map((_, column) => tuples.map((tuple) => tuple[column]));
      const columns = pk.map((c) => `"${c}"::text`).join(', ');
      const unnest = pk.map((_, n) => `$${n + 1}::text[]`).join(', ');
      const result = await db.query(`SELECT * FROM "${table}" WHERE (${columns}) IN (SELECT * FROM unnest(${unnest}))`, params);
      rows.push(...result.rows);
    }
  }
  return rows;
}

async function listImagesOnDisk(imagesDir: string): Promise<Set<string>> {
  const found = new Set<string>();
  if (!existsSync(imagesDir)) return found;
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue; // .deleted archive, .DS_Store, temp files
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else found.add(rel);
    }
  }
  await walk(imagesDir, '');
  return found;
}

type TableStats = { added: number; updated: number; unchanged: number; deleted: number };

/**
 * Brings data/<source>/ up to date with the source database.
 *
 * Every table is read from one REPEATABLE READ snapshot. For each table the source
 * sends only a primary key and an md5 per row; rows whose hash moved since the last
 * run (or that are missing locally) are fetched in full. Rows the source no longer
 * has are appended to deleted/<table>.ndjson before they leave the table file, so an
 * accidental delete on the source stays recoverable from the backup.
 */
async function syncMirror(opts: {
  dir: string;
  source: string;
  groups: ScopeGroup[];
  tables: string[];
  skipImages: boolean;
}): Promise<number> {
  const { dir, source, groups, tables, skipImages } = opts;
  const startedAt = new Date().toISOString();
  const manifestPath = join(dir, 'manifest.json');
  const hashesPath = join(dir, SYNC_STATE_DIR, 'hashes.json');

  const previous = await readJson<BundleManifest>(manifestPath);
  if (previous) {
    const same = previous.scope.length === groups.length && groups.every((g) => previous.scope.includes(g));
    if (!same) {
      console.error(`${dir} holds scope [${previous.scope.join(', ')}]; this run asks for [${groups.join(', ')}].`);
      console.error('A folder keeps the scope of its first run. Use another --output for a different scope.');
      return 1;
    }
  }
  const previousHashes = (await readJson<Record<string, Record<string, string>>>(hashesPath)) ?? {};
  await mkdir(dir, { recursive: true });

  console.log(`Syncing ${tables.length} tables into ${dir} (source '${source}')`);
  if (!previous || !existsSync(hashesPath)) console.log('  No sync state yet: every row is fetched once.');

  const db = createDbClient();
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const syncedAt = (await db.query('SELECT now()::timestamp AS at')).rows[0].at as string;

  const nextHashes: Record<string, Record<string, string>> = {};
  const results = new Map<string, { rows: Row[]; removed: Row[]; stats: TableStats }>();
  for (const table of tables) {
    const pk = await primaryKeyColumns(db, table);
    const keySelect = pk.map((c) => `"${c}"::text AS "${c}"`).join(', ');
    const hashRows = (await db.query(`SELECT ${keySelect}, md5(t::text) AS row_hash FROM "${table}" t`)).rows as Row[];
    const currentHashes: Record<string, string> = {};
    for (const r of hashRows) currentHashes[rowKey(r, pk)] = r.row_hash as string;

    const local = await readNdjson(join(dir, `${table}.ndjson`));
    const keyOf = (row: Row) => rowKey(row, pk);
    const plan = planTableSync(new Set(local.map(keyOf)), previousHashes[table], currentHashes);
    const fetched = await fetchRowsByKey(db, table, pk, plan.fetch);
    const merged = mergeRows(local, fetched, new Set(plan.remove), keyOf);

    nextHashes[table] = currentHashes;
    results.set(table, merged);
    const s = merged.stats;
    console.log(`  ${table}: ${merged.rows.length} rows (+${s.added} ~${s.updated} -${s.deleted})`);
  }
  await db.query('COMMIT');
  // Close before images: a long download over a tunnel outlasts idle timeouts.
  await db.end();

  // Archive first, then replace table files, then the hashes: a crash at any point
  // leaves either the old state or a state the next run repairs by refetching.
  for (const [table, { removed }] of results) {
    if (removed.length === 0) continue;
    const archive = join(dir, DELETED_DIR, `${table}.ndjson`);
    await mkdir(dirname(archive), { recursive: true });
    appendFileSync(archive, removed.map((row) => JSON.stringify({ deleted_detected_at: syncedAt, row }) + '\n').join(''));
  }
  for (const [table, { rows }] of results) await writeAtomically(join(dir, `${table}.ndjson`), toNdjson(rows));
  await writeAtomically(hashesPath, JSON.stringify(nextHashes) + '\n');

  // Images: download what live spots reference and the folder lacks; archive the rest.
  let images: BundleManifest['images'] = { downloaded: 0, failed: 0, skipped: true };
  let capExceeded = false;
  if (!skipImages && groups.includes('spots')) {
    const imagesDir = join(dir, 'images');
    const referenced = referencedImageKeys(results.get('spots')?.rows ?? []);
    const imagePlan = planImageSync(referenced, await listImagesOnDisk(imagesDir));
    for (const key of imagePlan.orphaned) {
      const target = join(imagesDir, DELETED_IMAGES_DIR, key);
      await mkdir(dirname(target), { recursive: true });
      await rename(join(imagesDir, key), target);
    }
    console.log(`Images: ${referenced.size} referenced, ${imagePlan.download.length} to download, ${imagePlan.orphaned.length} archived`);
    const run = await downloadImages(imagePlan.download, dir);
    capExceeded = run.capExceeded;
    images = {
      downloaded: run.downloaded,
      failed: run.failed,
      skipped: false,
      on_disk: (await listImagesOnDisk(imagesDir)).size,
      pending: run.pending,
      cap_exceeded: run.capExceeded,
    };
  }

  const manifest: BundleManifest = {
    version: 3,
    type: 'mirror',
    bundle_id: basename(dir),
    source_label: source,
    exported_at: new Date().toISOString(),
    high_watermark: syncedAt,
    source_database: process.env.DB_DATABASE || 'cleancentive',
    source_host: process.env.DB_HOST || 'localhost',
    scope: groups,
    tables: Object.fromEntries([...results].map(([table, r]) => [table, { row_count: r.rows.length }])),
    images,
  };
  await writeAtomically(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const totals = [...results.values()].reduce(
    (sum, r) => ({
      added: sum.added + r.stats.added,
      updated: sum.updated + r.stats.updated,
      deleted: sum.deleted + r.stats.deleted,
    }),
    { added: 0, updated: 0, deleted: 0 },
  );
  appendFileSync(
    join(dir, SYNC_LOG_FILE),
    JSON.stringify({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      source_snapshot_at: syncedAt,
      rows: totals,
      tables: Object.fromEntries(
        [...results]
          .filter(([, r]) => r.stats.added + r.stats.updated + r.stats.deleted > 0)
          .map(([table, r]) => [table, { added: r.stats.added, updated: r.stats.updated, deleted: r.stats.deleted }]),
      ),
      images,
    }) + '\n',
  );

  console.log('');
  console.log(`Sync complete → ${dir}`);
  console.log(`  Rows: +${totals.added} added, ~${totals.updated} changed, -${totals.deleted} archived as deleted`);
  if (!images.skipped) {
    console.log(`  Images: ${images.downloaded} downloaded, ${images.failed} failed, ${images.on_disk} on disk`);
  }
  if (capExceeded) {
    console.error(`  ${images.pending} images are still missing because the daily cap is used up. Run again after it resets.`);
    return EXIT_CAP_EXCEEDED;
  }
  return 0;
}

/** One-off snapshot of everything in scope into exactly `dir`. No sync state. */
async function exportSnapshot(opts: { dir: string; source: string; groups: ScopeGroup[]; tables: string[]; skipImages: boolean }): Promise<number> {
  const { dir, source, groups, tables, skipImages } = opts;
  await mkdir(dir, { recursive: true });
  const db = createDbClient();
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshotAt = (await db.query('SELECT now()::timestamp AS at')).rows[0].at as string;

  console.log(`Snapshot of ${tables.length} tables into ${dir}`);
  const counts: BundleManifest['tables'] = {};
  let spots: Row[] = [];
  for (const table of tables) {
    const rows = (await db.query(`SELECT * FROM "${table}"`)).rows as Row[];
    await writeAtomically(join(dir, `${table}.ndjson`), toNdjson(rows));
    counts[table] = { row_count: rows.length };
    if (table === 'spots') spots = rows;
    console.log(`  ${table}: ${rows.length} rows`);
  }
  await db.query('COMMIT');
  await db.end();

  let images: BundleManifest['images'] = { downloaded: 0, failed: 0, skipped: true };
  let capExceeded = false;
  if (!skipImages && groups.includes('spots')) {
    console.log('Downloading images from S3...');
    const run = await downloadImages([...referencedImageKeys(spots)].sort(), dir);
    capExceeded = run.capExceeded;
    images = { downloaded: run.downloaded, failed: run.failed, skipped: false, pending: run.pending, cap_exceeded: run.capExceeded };
  }

  const manifest: BundleManifest = {
    version: 3,
    type: 'full',
    bundle_id: basename(dir),
    source_label: source,
    exported_at: new Date().toISOString(),
    high_watermark: snapshotAt,
    source_database: process.env.DB_DATABASE || 'cleancentive',
    source_host: process.env.DB_HOST || 'localhost',
    scope: groups,
    tables: counts,
    images,
  };
  await writeAtomically(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Snapshot complete → ${dir}`);
  if (capExceeded) {
    console.error(`  ${images.pending} images are missing because the daily cap is used up. Rerun into the same --output to resume.`);
    return EXIT_CAP_EXCEEDED;
  }
  return 0;
}

async function main(): Promise<number> {
  if (hasArg('--help')) {
    printUsage();
    return 0;
  }
  if (hasArg('--incremental')) {
    console.error('--incremental is gone: the default export now updates data/<source>/ in place.');
    return 1;
  }

  const { groups, expanded, warnings } = resolveScope(getArgValue('--scope'));
  if (expanded.length > 0) console.log(`Scope auto-expanded to include: ${expanded.join(', ')}`);
  for (const warning of warnings) console.log(`Warning: ${warning}`);
  const tables = getTablesForGroups(groups);

  const source = safeLabel(getArgValue('--source') ?? process.env.BACKUP_SOURCE ?? '') || sourceLabel(process.env.DB_HOST || 'localhost');
  const explicitOutput = getArgValue('--output');
  const root = getArgValue('--output-root') ? resolvePath(getArgValue('--output-root')!) : DATA_DIR;
  const skipImages = hasArg('--no-images');

  if (hasArg('--full')) {
    if (!explicitOutput) {
      console.error('--full writes a one-off snapshot and needs --output <dir>.');
      return 1;
    }
    return exportSnapshot({ dir: resolvePath(explicitOutput), source, groups, tables, skipImages });
  }

  const dir = explicitOutput ? resolvePath(explicitOutput) : join(root, source);
  return syncMirror({ dir, source, groups, tables, skipImages });
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('Export failed:', error);
    process.exit(1);
  });
