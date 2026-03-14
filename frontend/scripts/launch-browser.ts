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

const CDP_PORT = Number(process.env.BROWSER_CDP_PORT ?? 9222);
const PROFILE_DIR = process.env.BROWSER_PROFILE_DIR ?? path.resolve(import.meta.dir, '..', '.browser-profile');
const MINIO_URL = 'http://localhost:9001';
const MINIO_USERNAME = process.env.MINIO_USERNAME ?? 'minioadmin';
const MINIO_PASSWORD = process.env.MINIO_PASSWORD ?? 'minioadmin';

const BASE_LAT = Number(process.env.BROWSER_LAT ?? 47.5596);
const BASE_LNG = Number(process.env.BROWSER_LNG ?? 7.5886);

function randomGeoInRadius(lat: number, lng: number, radiusKm: number) {
  const angle = Math.random() * 2 * Math.PI;
  const r = radiusKm * Math.sqrt(Math.random());
  const dLat = (r * Math.cos(angle)) / 111.32;
  const dLng = (r * Math.sin(angle)) / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { latitude: lat + dLat, longitude: lng + dLng, accuracy: 10 + Math.random() * 40 };
}

const mockLocation = randomGeoInRadius(BASE_LAT, BASE_LNG, 5);

const URLS = [
  MINIO_URL,
  'http://localhost:3000/api/v1/docs',
  'http://localhost:8025',
  process.env.BROWSER_URL ?? 'http://localhost:5173',
];

async function openUrl(context: BrowserContext, url: string) {
  const pages = context.pages();
  const existingPage =
    pages.find((p) => p.url().startsWith(url)) ??
    pages.find((p) => p.url() === 'about:blank');
  const page = existingPage ?? await context.newPage();

  if (!existingPage || page.url() !== url) {
    await page.goto(url);
  }

  if (url === MINIO_URL) {
    loginToMinio(page);
  }

  return page;
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

console.log('Launching shared Chromium browser...');
console.log(`Using browser profile: ${PROFILE_DIR}`);
console.log(`Mock geolocation:      ${mockLocation.latitude.toFixed(4)}, ${mockLocation.longitude.toFixed(4)} (5km around ${BASE_LAT}, ${BASE_LNG})`);

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
for (const url of URLS) {
  pages.push(await openUrl(context, url));
}

console.log(`\nBrowser ready with tabs:`);
for (const url of URLS) {
  if (url !== MINIO_URL) {
    console.log(`  - ${url}`);
  }
}
console.log(`CDP endpoint:    http://127.0.0.1:${CDP_PORT}`);
console.log('\nAgents can connect with:');
console.log(`  CDP_URL=http://127.0.0.1:${CDP_PORT} bun run test:e2e:shared`);
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
