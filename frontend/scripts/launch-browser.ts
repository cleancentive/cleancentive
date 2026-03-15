/**
 * Launch a shared Chromium browser for human + agent collaboration.
 *
 * Usage: bun run browse
 *
 * Starts a visible Chromium with CDP remote debugging enabled.
 * - Human can interact with the browser directly
 * - Coding agents can connect via CDP_URL to run Playwright scripts
 *
 * Environment variables:
 *   BROWSER_CDP_PORT  CDP remote debugging port (default: 9222)
 *   BROWSER_URL       First URL to open on launch (default: http://localhost:5173)
 *   BROWSER_PROFILE_DIR Persistent Chromium profile directory (default: frontend/.browser-profile)
 *   MINIO_USERNAME    MinIO console username (default: minioadmin)
 *   MINIO_PASSWORD    MinIO console password (default: minioadmin)
 *   BROWSER_LAT       Geolocation centre latitude (default: 47.5596 — Basel)
 *   BROWSER_LNG       Geolocation centre longitude (default: 7.5886 — Basel)
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

import {
  MINIO_URL,
  UMAMI_URL,
  buildBrowserToolTargets,
  randomGeoInRadius,
} from './launch-browser-config';
import { getExistingBrowserWSEndpoint } from './browser-session';

const CDP_PORT = Number(process.env.BROWSER_CDP_PORT ?? 9222);
const PROFILE_DIR = process.env.BROWSER_PROFILE_DIR ?? path.resolve(import.meta.dir, '..', '.browser-profile');
const MINIO_USERNAME = process.env.MINIO_USERNAME ?? 'minioadmin';
const MINIO_PASSWORD = process.env.MINIO_PASSWORD ?? 'minioadmin';
const UMAMI_USERNAME = process.env.UMAMI_USERNAME ?? 'admin';
const UMAMI_PASSWORD = process.env.UMAMI_PASSWORD ?? 'umami';

const BASE_LAT = Number(process.env.BROWSER_LAT ?? 47.5596);
const BASE_LNG = Number(process.env.BROWSER_LNG ?? 7.5886);

const mockLocation = randomGeoInRadius(BASE_LAT, BASE_LNG, 5);
const browserToolTargets = buildBrowserToolTargets(process.env);

async function openUrl(context: BrowserContext, target: (typeof browserToolTargets)[number]) {
  const pages = context.pages();
  const existingPage =
    pages.find((p) => p.url().startsWith(target.url)) ??
    pages.find((p) => p.url() === 'about:blank');
  const page = existingPage ?? await context.newPage();

  try {
    if (!existingPage || page.url() !== target.url) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
  } catch {
    console.log(`  - ${target.name}: ${target.url} (failed to open automatically)`);
    return { page, opened: false };
  }

  return { page, opened: true };
}

async function loginToMinio(page: Page) {
  try {
    await page.waitForSelector('input#accessKey', { timeout: 10000 });
    await page.fill('input#accessKey', MINIO_USERNAME);
    await page.fill('input#secretKey', MINIO_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    console.log(`  - ${MINIO_URL} (logged in)`);
  } catch {
    console.log(`  - ${MINIO_URL} (opened, login not completed automatically)`);
  }
}

async function loginToUmami(page: Page) {
  try {
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.fill('input[name="username"]', UMAMI_USERNAME);
    await page.fill('input[name="password"]', UMAMI_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    console.log(`  - ${UMAMI_URL} (logged in)`);
  } catch {
    console.log(`  - ${UMAMI_URL} (opened, login not completed automatically)`);
  }
}

console.log('Launching shared Chromium browser...');
console.log(`Using browser profile: ${PROFILE_DIR}`);
console.log(`Mock geolocation:      ${mockLocation.latitude.toFixed(4)}, ${mockLocation.longitude.toFixed(4)} (5km around ${BASE_LAT}, ${BASE_LNG})`);

// Try to add missing tabs to an existing browser via CDP HTTP API (no WebSocket needed).
const existingBrowserWSEndpoint = await getExistingBrowserWSEndpoint(CDP_PORT);

if (existingBrowserWSEndpoint) {
  try {
    // GET /json/list returns all open tabs with their URLs
    const listRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    if (!listRes.ok) throw new Error('failed to list tabs');
    const tabs = (await listRes.json()) as Array<{ url: string }>;
    const existingUrls = tabs.map((t) => t.url);

    const missingTargets = browserToolTargets.filter(
      (t) => !existingUrls.some((url) => url.startsWith(t.url)),
    );

    if (missingTargets.length === 0) {
      console.log('All tabs already open.');
    } else {
      console.log(`Opening ${missingTargets.length} missing tab(s)...`);
      for (const target of missingTargets) {
        // PUT /json/new?<url> opens a new tab (no login — sessions persist in the browser profile)
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${target.url}`, { method: 'PUT' });
        if (res.ok) {
          console.log(`  + ${target.name}: ${target.url}`);
        } else {
          console.log(`  - ${target.name}: ${target.url} (failed)`);
        }
      }
    }

    process.exit(0);
  } catch {
    console.log('Existing browser session is unresponsive, launching a new one...');
  }
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  permissions: ['geolocation', 'camera'],
  geolocation: mockLocation,
  args: [
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
  ],
});

// Open tabs sequentially so only the first URL claims the about:blank tab
const pages: Page[] = [];
const openedTargets: typeof browserToolTargets = [];
const pendingLogins: Promise<void>[] = [];
for (const target of browserToolTargets) {
  const result = await openUrl(context, target);
  pages.push(result.page);

  if (!result.opened) {
    continue;
  }

  openedTargets.push(target);

  if (target.login === 'minio') {
    // Run login in background so it doesn't block other tabs from opening
    pendingLogins.push(loginToMinio(result.page));
  } else if (target.login === 'umami') {
    pendingLogins.push(loginToUmami(result.page));
  }
}

// Wait for any background logins to finish before printing status
await Promise.allSettled(pendingLogins);

console.log(`\nBrowser ready with tabs:`);
for (const target of openedTargets) {
  if (target.url !== MINIO_URL && target.url !== UMAMI_URL) {
    console.log(`  - ${target.url}`);
  }
}
console.log(`CDP endpoint:    http://127.0.0.1:${CDP_PORT}`);
console.log('\nAgents can connect with:');
console.log(`  CDP_URL=http://127.0.0.1:${CDP_PORT} bun run test:e2e:shared`);
console.log(`  MCP: @playwright/mcp --cdp-url http://127.0.0.1:${CDP_PORT}`);
console.log('\nPress Ctrl+C to close.\n');

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await context.close().catch(() => {});
  process.exit(0);
}

context.on('close', shutdown);
process.on('SIGINT', shutdown);

await new Promise(() => {});
