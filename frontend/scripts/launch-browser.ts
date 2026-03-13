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
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const CDP_PORT = Number(process.env.BROWSER_CDP_PORT ?? 9222);
const APP_URL = process.env.BROWSER_URL ?? 'http://localhost:5173';
const PROFILE_DIR = process.env.BROWSER_PROFILE_DIR ?? path.resolve(import.meta.dir, '..', '.browser-profile');
const MINIO_URL = 'http://localhost:9001';
const MINIO_USERNAME = process.env.MINIO_USERNAME ?? 'minioadmin';
const MINIO_PASSWORD = process.env.MINIO_PASSWORD ?? 'minioadmin';
const EXTRA_URLS = [
  'http://localhost:3000/api/v1/docs',
  'http://localhost:8025',
  MINIO_URL,
].filter((url) => url !== APP_URL);

async function openUrl(context: BrowserContext, url: string) {
  const existingPage = context.pages().find((page) => page.url().startsWith(url));
  const page = existingPage ?? await context.newPage();

  if (!existingPage || page.url() !== url) {
    await page.goto(url);
  }

  if (url === MINIO_URL) {
    await loginToMinio(page);
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

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [`--remote-debugging-port=${CDP_PORT}`],
});

const appPage = await openUrl(context, APP_URL);

for (const url of EXTRA_URLS) {
  if (url === MINIO_URL) {
    await openUrl(context, url);
    continue;
  }

  await openUrl(context, url);
}

await appPage.bringToFront().catch(() => {});

console.log(`\nBrowser ready with tabs:`);
console.log(`  - ${APP_URL}`);
for (const url of EXTRA_URLS) {
  if (url !== MINIO_URL) {
    console.log(`  - ${url}`);
  }
}
console.log(`CDP endpoint:    http://127.0.0.1:${CDP_PORT}`);
console.log('\nAgents can connect with:');
console.log(`  CDP_URL=http://127.0.0.1:${CDP_PORT} bun run test:e2e:shared`);
console.log('\nPress Ctrl+C to close.\n');

context.on('close', () => process.exit(0));

process.on('SIGINT', async () => {
  await context.close();
  process.exit(0);
});
