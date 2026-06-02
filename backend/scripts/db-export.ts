import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { Client, types } from 'pg';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DATA_DIR,
  WATERMARK_COLUMN,
  type BundleManifest,
  type BundleType,
  bundleId,
  discoverBundles,
  findBase,
  resolvePath,
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
  teams: ['teams', 'team_email_patterns', 'team_memberships', 'team_messages'],
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

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

function printUsage(): void {
  console.log('Usage: bun run scripts/db-export.ts [--full | --incremental]');
  console.log('');
  console.log('By default writes an auto-named bundle into data/ (repo root), choosing');
  console.log('incremental when a compatible previous bundle exists, else a full export.');
  console.log('');
  console.log('Flags:');
  console.log('  --full              Force a full export (snapshot of all rows in scope)');
  console.log('  --incremental       Force an incremental export (error if no prior bundle)');
  console.log('  --output-root <dir> Folder to hold auto-named bundles (default: data/)');
  console.log('  --output <dir>      Write the bundle to exactly this dir (one-off)');
  console.log('  --scope <groups>    Comma-separated scope groups (default: all)');
  console.log('                      Groups: users, teams, cleanups, spots, labels, feedback, all');
  console.log('  --no-images         Skip S3 image download');
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

  // Check soft dependencies
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

  // Return groups in canonical order
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

async function downloadS3Object(s3Client: S3Client, bucket: string, key: string, outputDir: string): Promise<boolean> {
  const filePath = join(outputDir, 'images', key);
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });

  try {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) return false;

    const writeStream = createWriteStream(filePath);
    await pipeline(response.Body as Readable, writeStream);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('NoSuchKey') || message.includes('The specified key does not exist')) {
      return false;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  if (hasArg('--help')) {
    printUsage();
    return;
  }

  const skipImages = hasArg('--no-images');
  const scopeArg = getArgValue('--scope');
  const forceFull = hasArg('--full');
  const forceIncremental = hasArg('--incremental');

  if (forceFull && forceIncremental) {
    console.error('Pass only one of --full / --incremental.');
    process.exit(1);
  }

  const { groups, expanded, warnings } = resolveScope(scopeArg);

  if (expanded.length > 0) {
    console.log(`Scope auto-expanded to include: ${expanded.join(', ')}`);
  }
  for (const warning of warnings) {
    console.log(`Warning: ${warning}`);
  }

  const tables = getTablesForGroups(groups);

  const dbHost = process.env.DB_HOST || 'localhost';
  const srcLabel = sourceLabel(dbHost);

  // Where bundles live (for naming + base discovery) and where this one is written.
  const explicitOutput = getArgValue('--output');
  const outputRootArg = getArgValue('--output-root');
  const root = explicitOutput
    ? dirname(resolvePath(explicitOutput))
    : outputRootArg
      ? resolvePath(outputRootArg)
      : DATA_DIR;

  const dbClient = new Client({
    host: dbHost,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'cleancentive',
    password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
    database: process.env.DB_DATABASE || 'cleancentive',
  });

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

  await dbClient.connect();

  // One boundary for the whole export, taken from the DB clock in the same timestamp frame
  // as the created_at/updated_at columns (which are `timestamp` without tz).
  const boundary = (await dbClient.query('SELECT now()::timestamp AS wm')).rows[0].wm as string;

  // Full vs incremental: incremental when a compatible base bundle exists (unless --full).
  const base = forceFull ? null : findBase(discoverBundles(root), { sourceLabel: srcLabel, scope: groups });
  if (forceIncremental && !base) {
    console.error(
      `No compatible base bundle in ${root} for source '${srcLabel}' with this scope — ` +
        'run a full export first (or drop --incremental).',
    );
    await dbClient.end();
    process.exit(1);
  }
  const type: BundleType = base ? 'incremental' : 'full';
  const since = base ? base.manifest.high_watermark ?? null : null;
  const parent = base ? base.manifest.bundle_id ?? base.id : null;

  const outputDir = explicitOutput ? resolvePath(explicitOutput) : join(root, bundleId(srcLabel, boundary, type));
  await mkdir(outputDir, { recursive: true });

  console.log(`Export type: ${type}${type === 'incremental' ? ` (changes since ${since})` : ''}`);
  console.log(`Exporting ${tables.length} tables: ${tables.join(', ')}`);

  const manifest: BundleManifest = {
    version: 2,
    exported_at: new Date().toISOString(),
    source_database: process.env.DB_DATABASE || 'cleancentive',
    source_host: dbHost,
    source_label: srcLabel,
    type,
    bundle_id: basename(outputDir),
    since,
    high_watermark: boundary,
    parent,
    scope: groups,
    tables: {},
    images: { downloaded: 0, failed: 0, skipped: skipImages },
  };

  for (const table of tables) {
    const filePath = join(outputDir, `${table}.ndjson`);
    const writeStream = createWriteStream(filePath);

    let rowCount = 0;
    const cursorName = `export_cursor_${table}`;
    const batchSize = 1000;

    // Incremental: only rows changed in (since, boundary]. since/boundary are DB-produced
    // timestamp strings, safe to inline as quoted literals.
    const wmCol = WATERMARK_COLUMN[table] ?? 'updated_at';
    const where =
      type === 'incremental' && since
        ? ` WHERE "${wmCol}" > '${since}'::timestamp AND "${wmCol}" <= '${boundary}'::timestamp`
        : '';

    await dbClient.query('BEGIN');
    await dbClient.query(`DECLARE ${cursorName} CURSOR FOR SELECT * FROM "${table}"${where}`);

    while (true) {
      const result = await dbClient.query(`FETCH ${batchSize} FROM ${cursorName}`);
      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        writeStream.write(JSON.stringify(row) + '\n');
        rowCount++;
      }
    }

    await dbClient.query(`CLOSE ${cursorName}`);
    await dbClient.query('COMMIT');
    writeStream.end();

    // Wait for write stream to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    manifest.tables[table] = { row_count: rowCount };
    console.log(`  ${table}: ${rowCount} rows`);
  }

  // Download images for the spots in THIS bundle (incremental → only changed spots).
  const includeImages = !skipImages && groups.includes('spots');
  if (includeImages) {
    console.log('Downloading images from S3...');
    const spotsFile = join(outputDir, 'spots.ndjson');
    const spotsContent = await Bun.file(spotsFile).text();
    const lines = spotsContent.trim().split('\n').filter(Boolean);

    let downloaded = 0;
    let failed = 0;

    for (const line of lines) {
      const spot = JSON.parse(line);

      if (spot.image_key) {
        const ok = await downloadS3Object(s3Client, bucketName, spot.image_key, outputDir);
        if (ok) downloaded++;
        else failed++;
      }

      if (spot.thumbnail_key) {
        const ok = await downloadS3Object(s3Client, bucketName, spot.thumbnail_key, outputDir);
        if (ok) downloaded++;
        else failed++;
      }
    }

    manifest.images = { downloaded, failed, skipped: false };
    console.log(`  Images: ${downloaded} downloaded, ${failed} failed`);
  }

  await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await dbClient.end();

  console.log('');
  console.log(`Export complete (${type}) → ${outputDir}`);
  console.log(`  Scope: ${groups.join(', ')}`);
  console.log(`  Tables: ${Object.keys(manifest.tables).length}`);
  console.log(`  Total rows: ${Object.values(manifest.tables).reduce((sum, t) => sum + t.row_count, 0)}`);
  if (includeImages) {
    console.log(`  Images: ${manifest.images?.downloaded ?? 0} downloaded, ${manifest.images?.failed ?? 0} failed`);
  }
}

main().catch((error) => {
  console.error('Export failed:', error);
  process.exit(1);
});
