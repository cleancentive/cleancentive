import { readFile, readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { Client, types } from 'pg';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DATA_DIR,
  type BundleManifest,
  discoverBundles,
  resolveChain,
  resolvePath,
  sourceLabels,
} from './lib/bundles';

// Preserve raw timestamp strings from Postgres
types.setTypeParser(1114, (val) => val);
types.setTypeParser(1184, (val) => val);

type ScopeGroup = 'users' | 'teams' | 'cleanups' | 'spots' | 'labels' | 'feedback';

// NOTE: keep SCOPE_GROUPS and TABLE_ORDER identical to db-export.ts (duplicated by design).
const SCOPE_GROUPS: Record<ScopeGroup, string[]> = {
  labels: ['labels', 'label_translations'],
  users: ['users', 'user_emails', 'admins'],
  teams: ['teams', 'team_email_patterns', 'team_memberships', 'team_messages'],
  cleanups: ['cleanups', 'cleanup_dates', 'cleanup_participants', 'cleanup_messages'],
  spots: ['spots', 'detected_items', 'detected_item_edits', 'spot_edits'],
  feedback: ['feedback', 'feedback_responses'],
};

const ALL_GROUPS: ScopeGroup[] = ['labels', 'users', 'teams', 'cleanups', 'spots', 'feedback'];

const GROUP_DEPENDENCIES: Partial<Record<ScopeGroup, ScopeGroup[]>> = {
  teams: ['users'],
  cleanups: ['users'],
  spots: ['users'],
};

// Tables in topological insert order
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

// Columns on the users table that are nullable FKs pointing to tables loaded after users.
// In replace mode with deferred FK checks disabled, these must be NULLed on first pass
// and restored in a second pass after all tables are loaded.
const USERS_DEFERRED_COLUMNS = ['active_team_id', 'active_cleanup_date_id', 'avatar_email_id'];

const BATCH_SIZE = 500;

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

function printUsage(): void {
  console.log('Usage:');
  console.log('  Single bundle: bun run scripts/db-import.ts --input <dir> --mode <replace|merge>');
  console.log('  Chain restore: bun run scripts/db-import.ts --chain [--input <root>] [--source <label>]');
  console.log('');
  console.log('Flags:');
  console.log('  --input <dir>           Bundle dir (single) or root holding bundles (chain; default: data/)');
  console.log('  --mode <replace|merge>  Single-bundle: replace = truncate + insert; merge = upsert on PK');
  console.log('  --chain                 Rebuild from the latest full + its increments (full=replace, incr=merge)');
  console.log('  --source <label>        Chain: which source to restore (default: the only one present)');
  console.log('  --merge-base            Chain: apply the full via merge too (additive, no truncate)');
  console.log('  --scope <groups>        Override: only import these groups from the bundle(s)');
  console.log('  --no-images             Skip S3 image upload even if the bundle contains images');
  console.log('  --target-is-production  Required when DB_HOST is not localhost');
  console.log('  --dry-run               Print plan without writing');
  console.log('  --help                  Show this help');
}

function resolveScope(scopeArg: string | null, manifestScope: string[]): ScopeGroup[] {
  let requested: ScopeGroup[];
  if (!scopeArg || scopeArg === 'all') {
    requested = manifestScope as ScopeGroup[];
  } else {
    requested = scopeArg.split(',').map((s) => s.trim()) as ScopeGroup[];
    for (const g of requested) {
      if (!SCOPE_GROUPS[g]) {
        console.error(`Unknown scope group: ${g}`);
        console.error(`Valid groups: ${ALL_GROUPS.join(', ')}, all`);
        process.exit(1);
      }
      if (!manifestScope.includes(g)) {
        console.error(`Scope group '${g}' is not in the export manifest (exported: ${manifestScope.join(', ')})`);
        process.exit(1);
      }
    }
  }

  // Auto-expand required dependencies
  const groupSet = new Set(requested);
  for (const group of requested) {
    const deps = GROUP_DEPENDENCIES[group];
    if (deps) {
      for (const dep of deps) {
        if (!groupSet.has(dep)) {
          if (!manifestScope.includes(dep)) {
            console.error(`Scope group '${group}' requires '${dep}' which is not in the export`);
            process.exit(1);
          }
          groupSet.add(dep);
          console.log(`Scope auto-expanded to include: ${dep}`);
        }
      }
    }
  }

  return ALL_GROUPS.filter((g) => groupSet.has(g));
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

async function askConfirmation(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toUpperCase() === 'YES');
    });
  });
}

async function readNdjsonLines(filePath: string): Promise<Record<string, unknown>[]> {
  const content = await Bun.file(filePath).text();
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildInsertSql(table: string, columns: string[]): string {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = columns.map((_, i) => {
    return `$${i + 1}`;
  }).join(', ');
  return `INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`;
}

function buildUpsertSql(table: string, columns: string[]): string {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updates = columns
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ');
  return `INSERT INTO "${table}" (${cols}) VALUES (${placeholders}) ON CONFLICT ("id") DO UPDATE SET ${updates}`;
}

function buildBatchInsertSql(table: string, columns: string[], batchSize: number): string {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const rowPlaceholders: string[] = [];
  for (let r = 0; r < batchSize; r++) {
    const placeholders = columns.map((_, i) => `$${r * columns.length + i + 1}`).join(', ');
    rowPlaceholders.push(`(${placeholders})`);
  }
  return `INSERT INTO "${table}" (${cols}) VALUES ${rowPlaceholders.join(', ')}`;
}

function buildBatchUpsertSql(table: string, columns: string[], batchSize: number): string {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const rowPlaceholders: string[] = [];
  for (let r = 0; r < batchSize; r++) {
    const placeholders = columns.map((_, i) => `$${r * columns.length + i + 1}`).join(', ');
    rowPlaceholders.push(`(${placeholders})`);
  }
  const updates = columns
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ');
  return `INSERT INTO "${table}" (${cols}) VALUES ${rowPlaceholders.join(', ')} ON CONFLICT ("id") DO UPDATE SET ${updates}`;
}

async function ensureBucketExists(s3Client: S3Client, bucketName: string): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch {
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }
}

async function collectImageFiles(imagesDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        // Store path relative to imagesDir
        files.push(fullPath.substring(imagesDir.length + 1));
      }
    }
  }

  await walk(imagesDir);
  return files;
}

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'cleancentive',
    password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
    database: process.env.DB_DATABASE || 'cleancentive',
  };
}

async function readManifest(inputDir: string): Promise<BundleManifest> {
  const manifestPath = join(inputDir, 'manifest.json');
  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    console.error(`Cannot read manifest at: ${manifestPath}`);
    process.exit(1);
  }
  if (manifest.version !== 1 && manifest.version !== 2) {
    console.error(`Unsupported manifest version: ${manifest.version}`);
    process.exit(1);
  }
  return manifest;
}

async function imagesDirExists(inputDir: string): Promise<boolean> {
  try {
    return (await stat(join(inputDir, 'images'))).isDirectory();
  } catch {
    return false;
  }
}

async function trySetReplica(dbClient: Client): Promise<boolean> {
  try {
    await dbClient.query("SET session_replication_role = 'replica'");
    return true;
  } catch {
    console.log('Cannot set session_replication_role — using two-pass approach for circular FKs');
    return false;
  }
}

async function printReplaceDiff(dbClient: Client, tables: string[], manifest: BundleManifest): Promise<void> {
  for (const table of tables) {
    const result = await dbClient.query(`SELECT COUNT(*) as count FROM "${table}"`);
    const currentCount = parseInt(result.rows[0].count, 10);
    const exportCount = manifest.tables[table]?.row_count ?? 0;
    const diff = exportCount - currentCount;
    console.log(`  ${table}: ${currentCount} rows in DB → ${exportCount} in bundle (net ${diff >= 0 ? '+' : ''}${diff})`);
  }
}

type Stats = Record<string, { inserted: number; updated: number }>;

// Apply ONE bundle to an already-open connection/transaction. The caller owns
// connect / BEGIN / COMMIT / session_replication_role. Returns per-table counts.
async function applyBundle(
  dbClient: Client,
  inputDir: string,
  manifest: BundleManifest,
  mode: 'replace' | 'merge',
  opts: { scopeArg: string | null; canDeferFKs: boolean },
): Promise<Stats> {
  const groups = resolveScope(opts.scopeArg, manifest.scope);
  const availableTables = getTablesForGroups(groups).filter((t) => manifest.tables[t]);
  const missingTables = getTablesForGroups(groups).filter((t) => !manifest.tables[t]);
  if (missingTables.length > 0) {
    console.log(`  (not in bundle, skipped: ${missingTables.join(', ')})`);
  }

  const stats: Stats = {};

  if (mode === 'replace') {
    // Truncate in reverse order
    const truncateOrder = [...availableTables].reverse();
    for (const table of truncateOrder) {
      await dbClient.query(`TRUNCATE "${table}" CASCADE`);
    }
    console.log(`  Truncated ${truncateOrder.length} tables`);

    // Track deferred user rows if we can't defer FKs
    let userRows: Record<string, unknown>[] | null = null;

    for (const table of availableTables) {
      const rows = await readNdjsonLines(join(inputDir, `${table}.ndjson`));
      stats[table] = { inserted: 0, updated: 0 };
      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows (empty)`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const needsTwoPass = !opts.canDeferFKs && table === 'users';
      if (needsTwoPass) userRows = rows;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        if (batch.length === BATCH_SIZE) {
          const sql = buildBatchInsertSql(table, columns, BATCH_SIZE);
          const values: unknown[] = [];
          for (const row of batch) {
            for (const col of columns) {
              let val = (row as Record<string, unknown>)[col];
              if (needsTwoPass && USERS_DEFERRED_COLUMNS.includes(col)) val = null;
              if (val !== null && typeof val === 'object') val = JSON.stringify(val);
              values.push(val);
            }
          }
          await dbClient.query(sql, values);
        } else {
          for (const row of batch) {
            const sql = buildInsertSql(table, columns);
            const values = columns.map((col) => {
              let val = (row as Record<string, unknown>)[col];
              if (needsTwoPass && USERS_DEFERRED_COLUMNS.includes(col)) val = null;
              if (val !== null && typeof val === 'object') val = JSON.stringify(val);
              return val;
            });
            await dbClient.query(sql, values);
          }
        }
        stats[table].inserted += batch.length;
      }
      console.log(`  ${table}: ${stats[table].inserted} rows inserted`);
    }

    // Second pass: restore deferred user columns
    if (!opts.canDeferFKs && userRows) {
      let updated = 0;
      for (const row of userRows) {
        const r = row as Record<string, unknown>;
        const hasDeferred = USERS_DEFERRED_COLUMNS.some((col) => r[col] !== null && r[col] !== undefined);
        if (hasDeferred) {
          const setClauses = USERS_DEFERRED_COLUMNS
            .filter((col) => r[col] !== null && r[col] !== undefined)
            .map((col, i) => `"${col}" = $${i + 2}`)
            .join(', ');
          const values = [
            r.id,
            ...USERS_DEFERRED_COLUMNS.filter((col) => r[col] !== null && r[col] !== undefined).map((col) => r[col]),
          ];
          if (setClauses) {
            await dbClient.query(`UPDATE "users" SET ${setClauses} WHERE "id" = $1`, values);
            updated++;
          }
        }
      }
      if (updated > 0) console.log(`  users: ${updated} rows updated (deferred FK columns restored)`);
    }
  } else {
    // Merge mode: upsert
    for (const table of availableTables) {
      const rows = await readNdjsonLines(join(inputDir, `${table}.ndjson`));
      stats[table] = { inserted: 0, updated: 0 };
      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows (empty)`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const existingResult = await dbClient.query(`SELECT "id" FROM "${table}"`);
      const existingIds = new Set(existingResult.rows.map((r) => r.id));

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        if (batch.length === BATCH_SIZE) {
          const sql = buildBatchUpsertSql(table, columns, BATCH_SIZE);
          const values: unknown[] = [];
          for (const row of batch) {
            for (const col of columns) {
              let val = (row as Record<string, unknown>)[col];
              if (val !== null && typeof val === 'object') val = JSON.stringify(val);
              values.push(val);
            }
          }
          await dbClient.query(sql, values);
        } else {
          for (const row of batch) {
            const sql = buildUpsertSql(table, columns);
            const values = columns.map((col) => {
              let val = (row as Record<string, unknown>)[col];
              if (val !== null && typeof val === 'object') val = JSON.stringify(val);
              return val;
            });
            await dbClient.query(sql, values);
          }
        }
        for (const row of batch) {
          const id = (row as Record<string, unknown>).id as string;
          if (existingIds.has(id)) stats[table].updated++;
          else stats[table].inserted++;
        }
      }
      console.log(`  ${table}: ${stats[table].inserted} inserted, ${stats[table].updated} updated`);
    }
  }

  return stats;
}

async function uploadBundleImages(
  inputDir: string,
  skipImages: boolean,
): Promise<{ uploaded: number; failed: number } | null> {
  if (skipImages || !(await imagesDirExists(inputDir))) return null;
  const imagesDir = join(inputDir, 'images');
  const bucketName = process.env.S3_BUCKET || 'cleancentive-images';
  const s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9002',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
  });
  await ensureBucketExists(s3Client, bucketName);

  const imageFiles = await collectImageFiles(imagesDir);
  let uploaded = 0;
  let failed = 0;
  for (const relPath of imageFiles) {
    try {
      const body = await readFile(join(imagesDir, relPath));
      const contentType = relPath.endsWith('.png') ? 'image/png' : relPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      await s3Client.send(new PutObjectCommand({ Bucket: bucketName, Key: relPath, Body: body, ContentType: contentType }));
      uploaded++;
    } catch (error) {
      failed++;
      console.error(`  Failed to upload ${relPath}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { uploaded, failed };
}

function printSummary(statsList: Stats[]): void {
  let inserted = 0;
  let updated = 0;
  for (const s of statsList) {
    for (const v of Object.values(s)) {
      inserted += v.inserted;
      updated += v.updated;
    }
  }
  console.log('');
  console.log('Import complete.');
  console.log(`  Total: ${inserted} inserted, ${updated} updated`);
}

async function runSingleBundle(opts: {
  skipImages: boolean;
  dryRun: boolean;
  targetIsProduction: boolean;
  scopeArg: string | null;
}): Promise<void> {
  const inputArg = getArgValue('--input');
  const mode = getArgValue('--mode');
  if (!inputArg || !mode) {
    printUsage();
    process.exit(1);
  }
  if (mode !== 'replace' && mode !== 'merge') {
    console.error(`Invalid mode: ${mode}. Must be 'replace' or 'merge'.`);
    process.exit(1);
  }
  const inputDir = resolvePath(inputArg);
  const manifest = await readManifest(inputDir);

  const groups = resolveScope(opts.scopeArg, manifest.scope);
  const availableTables = getTablesForGroups(groups).filter((t) => manifest.tables[t]);
  const imagesPresent = await imagesDirExists(inputDir);

  console.log(`Import mode: ${mode}`);
  console.log(`Tables: ${availableTables.join(', ')}`);
  console.log(`Images: ${imagesPresent ? (opts.skipImages ? 'skipped (--no-images)' : 'yes') : 'none in export'}`);

  if (opts.dryRun) {
    console.log('');
    console.log('Dry run — no changes will be made.');
    for (const table of availableTables) console.log(`  ${table}: ${manifest.tables[table].row_count} rows`);
    return;
  }

  if (opts.targetIsProduction && mode === 'replace') {
    const c = new Client(dbConfig());
    await c.connect();
    console.log('');
    console.log('WARNING: About to REPLACE production data.');
    await printReplaceDiff(c, availableTables, manifest);
    await c.end();
    if (!(await askConfirmation('\nType YES to proceed: '))) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const dbClient = new Client(dbConfig());
  await dbClient.connect();
  const canDeferFKs = mode === 'replace' ? await trySetReplica(dbClient) : false;
  await dbClient.query('BEGIN');
  const stats = await applyBundle(dbClient, inputDir, manifest, mode, { scopeArg: opts.scopeArg, canDeferFKs });
  if (canDeferFKs) await dbClient.query("SET session_replication_role = 'origin'");
  await dbClient.query('COMMIT');
  await dbClient.end();
  console.log('Database import complete.');

  const img = await uploadBundleImages(inputDir, opts.skipImages);
  if (img) console.log(`  Images: ${img.uploaded} uploaded, ${img.failed} failed`);

  printSummary([stats]);
}

async function runChain(opts: {
  skipImages: boolean;
  dryRun: boolean;
  targetIsProduction: boolean;
  scopeArg: string | null;
  mergeBase: boolean;
}): Promise<void> {
  const inputArg = getArgValue('--input');
  const root = inputArg ? resolvePath(inputArg) : DATA_DIR;
  const bundles = discoverBundles(root);
  if (bundles.length === 0) {
    console.error(`No bundles found in ${root}.`);
    process.exit(1);
  }

  let src = getArgValue('--source');
  if (!src) {
    const labels = sourceLabels(bundles);
    if (labels.length === 1) {
      src = labels[0];
    } else {
      console.error(`Multiple sources in ${root} — pass --source <label> (found: ${labels.join(', ') || 'none'}).`);
      process.exit(1);
    }
  }

  const chain = resolveChain(bundles, { sourceLabel: src });
  if (chain.length === 0) {
    console.error(`No full bundle found for source '${src}' in ${root}.`);
    process.exit(1);
  }

  const bundleMode = (i: number): 'replace' | 'merge' => (i === 0 && !opts.mergeBase ? 'replace' : 'merge');

  console.log(`Chain restore for source '${src}' — ${chain.length} bundle(s):`);
  chain.forEach((b, i) => {
    const rows = Object.values(b.manifest.tables).reduce((s, t) => s + t.row_count, 0);
    console.log(`  ${i + 1}. ${b.id} [${b.manifest.type}] → ${bundleMode(i)} (${rows} rows)`);
  });

  if (opts.dryRun) {
    console.log('');
    console.log('Dry run — no changes will be made.');
    return;
  }

  const base = chain[0];
  if (opts.targetIsProduction && !opts.mergeBase) {
    const c = new Client(dbConfig());
    await c.connect();
    console.log('');
    console.log('WARNING: About to REPLACE production data via chain restore.');
    const groups = resolveScope(opts.scopeArg, base.manifest.scope);
    const availableTables = getTablesForGroups(groups).filter((t) => base.manifest.tables[t]);
    await printReplaceDiff(c, availableTables, base.manifest);
    await c.end();
    if (!(await askConfirmation('\nType YES to proceed: '))) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const dbClient = new Client(dbConfig());
  await dbClient.connect();
  const canDeferFKs = await trySetReplica(dbClient);
  await dbClient.query('BEGIN');
  const allStats: Stats[] = [];
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i];
    console.log(`\nApplying ${b.id} (${bundleMode(i)}):`);
    allStats.push(await applyBundle(dbClient, b.dir, b.manifest, bundleMode(i), { scopeArg: opts.scopeArg, canDeferFKs }));
  }
  if (canDeferFKs) await dbClient.query("SET session_replication_role = 'origin'");
  await dbClient.query('COMMIT');
  await dbClient.end();
  console.log('\nDatabase chain restore complete.');

  for (const b of chain) {
    const img = await uploadBundleImages(b.dir, opts.skipImages);
    if (img) console.log(`  ${b.id} images: ${img.uploaded} uploaded, ${img.failed} failed`);
  }

  printSummary(allStats);
}

async function main(): Promise<void> {
  if (hasArg('--help')) {
    printUsage();
    return;
  }

  const opts = {
    skipImages: hasArg('--no-images'),
    dryRun: hasArg('--dry-run'),
    targetIsProduction: hasArg('--target-is-production'),
    scopeArg: getArgValue('--scope'),
  };

  // Production safety (applies to single-bundle and chain modes)
  const dbHost = process.env.DB_HOST || 'localhost';
  const isLocalhost = dbHost === 'localhost' || dbHost === '127.0.0.1';
  if (!isLocalhost && !opts.targetIsProduction) {
    console.error('ERROR: DB_HOST is not localhost. Pass --target-is-production to confirm.');
    process.exit(1);
  }

  if (hasArg('--chain')) {
    await runChain({ ...opts, mergeBase: hasArg('--merge-base') });
  } else {
    await runSingleBundle(opts);
  }
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
