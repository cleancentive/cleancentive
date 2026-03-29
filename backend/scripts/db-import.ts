import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { Client, types } from 'pg';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Preserve raw timestamp strings from Postgres
types.setTypeParser(1114, (val) => val);
types.setTypeParser(1184, (val) => val);

type ScopeGroup = 'users' | 'teams' | 'cleanups' | 'spots' | 'labels' | 'feedback';

const SCOPE_GROUPS: Record<ScopeGroup, string[]> = {
  labels: ['labels', 'label_translations'],
  users: ['users', 'user_emails', 'admins'],
  teams: ['teams', 'team_email_patterns', 'team_memberships', 'team_messages'],
  cleanups: ['cleanups', 'cleanup_dates', 'cleanup_participants', 'cleanup_messages'],
  spots: ['spots', 'detected_items', 'detected_item_edits'],
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
  'feedback',
  'feedback_responses',
];

// Columns on the users table that are nullable FKs pointing to tables loaded after users.
// In replace mode with deferred FK checks disabled, these must be NULLed on first pass
// and restored in a second pass after all tables are loaded.
const USERS_DEFERRED_COLUMNS = ['active_team_id', 'active_cleanup_date_id', 'avatar_email_id'];

type Manifest = {
  version: number;
  exported_at: string;
  source_database: string;
  source_host: string;
  scope: string[];
  tables: Record<string, { row_count: number }>;
  images?: { downloaded: number; failed: number; skipped: boolean };
};

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

function printUsage(): void {
  console.log('Usage: bun run scripts/db-import.ts --input <dir> --mode <replace|merge>');
  console.log('');
  console.log('Flags:');
  console.log('  --input <dir>           Directory from a previous export');
  console.log('  --mode <replace|merge>  replace = truncate + insert; merge = upsert on PK');
  console.log('  --scope <groups>        Override: only import these groups from the export');
  console.log('  --no-images             Skip S3 image upload even if export contains images');
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

async function main(): Promise<void> {
  if (hasArg('--help')) {
    printUsage();
    return;
  }

  const inputDir = getArgValue('--input');
  const mode = getArgValue('--mode');

  if (!inputDir || !mode) {
    printUsage();
    process.exit(1);
  }

  if (mode !== 'replace' && mode !== 'merge') {
    console.error(`Invalid mode: ${mode}. Must be 'replace' or 'merge'.`);
    process.exit(1);
  }

  const skipImages = hasArg('--no-images');
  const dryRun = hasArg('--dry-run');
  const targetIsProduction = hasArg('--target-is-production');

  // Read manifest
  const manifestPath = join(inputDir, 'manifest.json');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    console.error(`Cannot read manifest at: ${manifestPath}`);
    process.exit(1);
  }

  if (manifest.version !== 1) {
    console.error(`Unsupported manifest version: ${manifest.version}`);
    process.exit(1);
  }

  // Production safety
  const dbHost = process.env.DB_HOST || 'localhost';
  const isLocalhost = dbHost === 'localhost' || dbHost === '127.0.0.1';
  if (!isLocalhost && !targetIsProduction) {
    console.error('ERROR: DB_HOST is not localhost. Pass --target-is-production to confirm.');
    process.exit(1);
  }

  const scopeArg = getArgValue('--scope');
  const groups = resolveScope(scopeArg, manifest.scope);
  const tables = getTablesForGroups(groups);

  // Filter tables to those actually present in the export
  const availableTables = tables.filter((t) => manifest.tables[t]);
  const missingTables = tables.filter((t) => !manifest.tables[t]);
  if (missingTables.length > 0) {
    console.log(`Tables not in export (skipped): ${missingTables.join(', ')}`);
  }

  // Check for images directory
  const imagesDir = join(inputDir, 'images');
  let hasImages = false;
  try {
    const imgStat = await stat(imagesDir);
    hasImages = imgStat.isDirectory();
  } catch {
    // no images directory
  }
  const importImages = hasImages && !skipImages;

  console.log(`Import mode: ${mode}`);
  console.log(`Tables: ${availableTables.join(', ')}`);
  console.log(`Images: ${importImages ? 'yes' : hasImages ? 'skipped (--no-images)' : 'none in export'}`);

  if (dryRun) {
    console.log('');
    console.log('Dry run — no changes will be made.');
    for (const table of availableTables) {
      console.log(`  ${table}: ${manifest.tables[table].row_count} rows`);
    }
    return;
  }

  // Production confirmation for replace mode
  if (targetIsProduction && mode === 'replace') {
    const dbClient = new Client({
      host: dbHost,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USERNAME || 'cleancentive',
      password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
      database: process.env.DB_DATABASE || 'cleancentive',
    });
    await dbClient.connect();

    console.log('');
    console.log('WARNING: About to REPLACE production data.');
    for (const table of availableTables) {
      const result = await dbClient.query(`SELECT COUNT(*) as count FROM "${table}"`);
      const currentCount = parseInt(result.rows[0].count, 10);
      const exportCount = manifest.tables[table].row_count;
      const diff = exportCount - currentCount;
      const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;
      console.log(`  ${table}: ${currentCount} rows in DB → ${exportCount} rows in export (net ${diffStr})`);
    }
    await dbClient.end();

    const confirmed = await askConfirmation('\nType YES to proceed: ');
    if (!confirmed) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const dbClient = new Client({
    host: dbHost,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'cleancentive',
    password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
    database: process.env.DB_DATABASE || 'cleancentive',
  });

  await dbClient.connect();

  // Try to use session_replication_role for deferred FK checks
  let canDeferFKs = false;
  if (mode === 'replace') {
    try {
      await dbClient.query("SET session_replication_role = 'replica'");
      canDeferFKs = true;
    } catch {
      console.log('Cannot set session_replication_role — using two-pass approach for circular FKs');
    }
  }

  await dbClient.query('BEGIN');

  const stats: Record<string, { inserted: number; updated: number }> = {};
  const BATCH_SIZE = 500;

  if (mode === 'replace') {
    // Truncate in reverse order
    const truncateOrder = [...availableTables].reverse();
    for (const table of truncateOrder) {
      await dbClient.query(`TRUNCATE "${table}" CASCADE`);
    }
    console.log(`Truncated ${truncateOrder.length} tables`);

    // Track deferred user rows if we can't defer FKs
    let userRows: Record<string, unknown>[] | null = null;

    // Insert in forward order
    for (const table of availableTables) {
      const filePath = join(inputDir, `${table}.ndjson`);
      const rows = await readNdjsonLines(filePath);
      stats[table] = { inserted: 0, updated: 0 };

      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows (empty)`);
        continue;
      }

      let columns = Object.keys(rows[0]);

      // If we can't defer FKs and this is the users table, null out circular FK columns
      const needsTwoPass = !canDeferFKs && table === 'users';
      if (needsTwoPass) {
        userRows = rows;
      }

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        if (batch.length === BATCH_SIZE) {
          const sql = buildBatchInsertSql(table, columns, BATCH_SIZE);
          const values: unknown[] = [];
          for (const row of batch) {
            for (const col of columns) {
              let val = (row as Record<string, unknown>)[col];
              if (needsTwoPass && USERS_DEFERRED_COLUMNS.includes(col)) {
                val = null;
              }
              if (val !== null && typeof val === 'object') {
                val = JSON.stringify(val);
              }
              values.push(val);
            }
          }
          await dbClient.query(sql, values);
        } else {
          // Remaining partial batch — insert one by one
          for (const row of batch) {
            const sql = buildInsertSql(table, columns);
            const values = columns.map((col) => {
              let val = (row as Record<string, unknown>)[col];
              if (needsTwoPass && USERS_DEFERRED_COLUMNS.includes(col)) {
                val = null;
              }
              if (val !== null && typeof val === 'object') {
                val = JSON.stringify(val);
              }
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
    if (!canDeferFKs && userRows) {
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
      if (updated > 0) {
        console.log(`  users: ${updated} rows updated (deferred FK columns restored)`);
      }
    }

    if (canDeferFKs) {
      await dbClient.query("SET session_replication_role = 'origin'");
    }
  } else {
    // Merge mode: upsert
    for (const table of availableTables) {
      const filePath = join(inputDir, `${table}.ndjson`);
      const rows = await readNdjsonLines(filePath);
      stats[table] = { inserted: 0, updated: 0 };

      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows (empty)`);
        continue;
      }

      const columns = Object.keys(rows[0]);

      // Get existing IDs for this table to track insert vs update
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
              if (val !== null && typeof val === 'object') {
                val = JSON.stringify(val);
              }
              values.push(val);
            }
          }
          await dbClient.query(sql, values);
        } else {
          for (const row of batch) {
            const sql = buildUpsertSql(table, columns);
            const values = columns.map((col) => {
              let val = (row as Record<string, unknown>)[col];
              if (val !== null && typeof val === 'object') {
                val = JSON.stringify(val);
              }
              return val;
            });
            await dbClient.query(sql, values);
          }
        }

        for (const row of batch) {
          const id = (row as Record<string, unknown>).id as string;
          if (existingIds.has(id)) {
            stats[table].updated++;
          } else {
            stats[table].inserted++;
          }
        }
      }

      console.log(`  ${table}: ${stats[table].inserted} inserted, ${stats[table].updated} updated`);
    }
  }

  await dbClient.query('COMMIT');
  await dbClient.end();
  console.log('Database import complete.');

  // Import images
  if (importImages) {
    console.log('Uploading images to S3...');
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
      const fullPath = join(imagesDir, relPath);
      try {
        const body = await readFile(fullPath);
        const contentType = relPath.endsWith('.png')
          ? 'image/png'
          : relPath.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: relPath,
            Body: body,
            ContentType: contentType,
          }),
        );
        uploaded++;
      } catch (error) {
        failed++;
        console.error(`  Failed to upload ${relPath}: ${error instanceof Error ? error.message : error}`);
      }
    }

    console.log(`  Images: ${uploaded} uploaded, ${failed} failed`);
  }

  console.log('');
  console.log('Import complete.');
  const totalInserted = Object.values(stats).reduce((sum, s) => sum + s.inserted, 0);
  const totalUpdated = Object.values(stats).reduce((sum, s) => sum + s.updated, 0);
  console.log(`  Total: ${totalInserted} inserted, ${totalUpdated} updated`);
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
