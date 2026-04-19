/**
 * Provision Outline (the wiki) for cleancentive integration:
 *
 * 1. Ensure the `cleancentive-wiki` MinIO bucket exists (Outline FILE_STORAGE=s3).
 * 2. If at least one cleancentive user has signed into Outline via SSO (so a
 *    team + user row exists in Outline's DB), idempotently:
 *    - Create the Umami analytics integration so wiki pageviews flow into the
 *      same Umami instance as the main app (separate website ID).
 *    - Set the workspace avatar to cleancentive's logo for matching branding.
 *    - Promote cleancentive admins (from ADMIN_EMAILS) to Outline admin role.
 *
 * Operates by direct SQL on Outline's database — Outline reads its
 * configuration on every request, so changes take effect immediately. No
 * Outline API token required, no manual operator step.
 *
 * If Outline's DB is empty (no SSO sign-in yet), the script ensures the bucket
 * and exits cleanly. Re-runs on every `bun dev`, so as soon as a user signs
 * in once, the next `bun dev` provisions the integrations.
 *
 * Idempotent — safe to run on every `bun dev`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { Client as PgClient } from 'pg';

// Source backend/.env so we pick up ADMIN_EMAILS, DB creds, etc. without
// requiring duplicate config in the repo root.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ENV = resolve(SCRIPT_DIR, '..', 'backend', '.env');
if (existsSync(BACKEND_ENV)) {
  for (const line of readFileSync(BACKEND_ENV, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
}

// --- config ----------------------------------------------------------------
const UMAMI_BASE_URL = process.env.UMAMI_PUBLIC_URL ?? 'https://analytics.cleancentive.local';
const UMAMI_ADMIN_URL = process.env.UMAMI_URL ?? 'http://localhost:3001';
const UMAMI_USERNAME = process.env.UMAMI_USERNAME ?? 'admin';
const UMAMI_PASSWORD = process.env.UMAMI_PASSWORD ?? 'umami';
const UMAMI_WIKI_WEBSITE_NAME = 'Cleancentive Wiki';
const UMAMI_WIKI_DOMAIN = 'wiki.cleancentive.local';

const TEAM_LOGO_URL =
  process.env.OUTLINE_TEAM_LOGO_URL ?? 'https://cleancentive.local/icon.svg';

const PG_OUTLINE = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME ?? 'cleancentive',
  password: process.env.DB_PASSWORD ?? 'cleancentive_dev_password',
  database: 'outline',
};

// --- MinIO bucket ----------------------------------------------------------
async function ensureWikiBucket(): Promise<void> {
  const client = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9002',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    },
  });
  const bucket = 'cleancentive-wiki';
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Outline: created MinIO bucket "${bucket}".`);
  }
}

// --- Umami: get-or-create wiki website -------------------------------------
async function getOrCreateUmamiWikiWebsite(): Promise<string> {
  const loginRes = await fetch(`${UMAMI_ADMIN_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: UMAMI_USERNAME, password: UMAMI_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`Umami login failed: ${loginRes.status}`);
  const { token } = (await loginRes.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const listRes = await fetch(`${UMAMI_ADMIN_URL}/api/websites`, { headers });
  const { data } = (await listRes.json()) as { data: Array<{ id: string; name: string }> };
  const existing = data.find((w) => w.name === UMAMI_WIKI_WEBSITE_NAME);
  if (existing) return existing.id;

  const createRes = await fetch(`${UMAMI_ADMIN_URL}/api/websites`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: UMAMI_WIKI_WEBSITE_NAME, domain: UMAMI_WIKI_DOMAIN }),
  });
  if (!createRes.ok) throw new Error(`Failed to create Umami wiki website: ${createRes.status}`);
  const created = (await createRes.json()) as { id: string };
  console.log(`Outline: created Umami website "${UMAMI_WIKI_WEBSITE_NAME}" (${created.id}).`);
  return created.id;
}

// --- Outline DB: provision Umami + branding --------------------------------
// Avatar sync and admin role sync are now handled in real-time by the
// backend's OutlineSyncService (backend/src/outline-sync/).
type TeamRow = { id: string; avatarUrl: string | null };

async function provisionInOutline(websiteId: string): Promise<void> {
  const pg = new PgClient(PG_OUTLINE);
  await pg.connect();
  try {
    const teams = await pg.query<TeamRow>(`SELECT id, "avatarUrl" FROM teams LIMIT 1`);
    const team = teams.rows[0];
    if (!team) {
      console.log('Outline: no team yet (no SSO sign-in has happened) — skipping provisioning.');
      console.log('  Once you sign into https://wiki.cleancentive.local once, the next');
      console.log('  `bun dev` will provision the Umami integration and branding.');
      return;
    }

    // Branding
    if (team.avatarUrl !== TEAM_LOGO_URL) {
      await pg.query(`UPDATE teams SET "avatarUrl" = $1, "updatedAt" = NOW() WHERE id = $2`, [
        TEAM_LOGO_URL,
        team.id,
      ]);
      console.log(`Outline: set workspace avatar → ${TEAM_LOGO_URL}`);
    }

    // Umami integration
    const settings = { measurementId: websiteId, instanceUrl: UMAMI_BASE_URL, scriptName: '/script.js' };
    const existing = await pg.query<{ id: string; settings: any }>(
      `SELECT id, settings FROM integrations WHERE service = 'umami' AND "teamId" = $1 LIMIT 1`,
      [team.id],
    );
    if (existing.rows[0]) {
      const cur = existing.rows[0].settings ?? {};
      if (cur.measurementId !== settings.measurementId || cur.instanceUrl !== settings.instanceUrl || cur.scriptName !== settings.scriptName) {
        await pg.query(
          `UPDATE integrations SET settings = $1, "updatedAt" = NOW() WHERE id = $2`,
          [settings, existing.rows[0].id],
        );
        console.log(`Outline: updated Umami integration → ${UMAMI_BASE_URL} / ${websiteId}`);
      }
    } else {
      await pg.query(
        `INSERT INTO integrations (id, type, service, "teamId", settings, "createdAt", "updatedAt")
         VALUES ($1, 'analytics', 'umami', $2, $3, NOW(), NOW())`,
        [randomUUID(), team.id, settings],
      );
      console.log(`Outline: created Umami integration → ${UMAMI_BASE_URL} / ${websiteId}`);
    }
  } finally {
    await pg.end();
  }
}

// --- main ------------------------------------------------------------------
try {
  await ensureWikiBucket();
} catch (e) {
  console.warn(`Outline: bucket setup skipped (${e instanceof Error ? e.message : e}).`);
}

try {
  const websiteId = await getOrCreateUmamiWikiWebsite();
  await provisionInOutline(websiteId);
} catch (e) {
  console.warn(`Outline: provisioning skipped (${e instanceof Error ? e.message : e}).`);
}
