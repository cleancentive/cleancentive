/**
 * Launch a shared Chromium browser for human + agent collaboration.
 *
 * Usage: bun run browser:launch
 *
 * Starts a visible Chromium with CDP remote debugging enabled.
 * - Human can interact with the browser directly
 * - Coding agents can connect via CDP_URL to run Playwright scripts
 *
 * Environment variables:
 *   BROWSER_CDP_PORT  CDP remote debugging port (default: 9222)
 *   BROWSER_URL       URL to open on launch (default: http://localhost:5173)
 */
import { chromium } from '@playwright/test';

const CDP_PORT = Number(process.env.BROWSER_CDP_PORT ?? 9222);
const APP_URL = process.env.BROWSER_URL ?? 'http://localhost:5173';

console.log('Launching shared Chromium browser...');

const browser = await chromium.launch({
  headless: false,
  args: [`--remote-debugging-port=${CDP_PORT}`],
});

const context = await browser.newContext();
const page = await context.newPage();
await page.goto(APP_URL);

console.log(`\nBrowser ready at ${APP_URL}`);
console.log(`CDP endpoint:    ws://127.0.0.1:${CDP_PORT}`);
console.log('\nAgents can connect with:');
console.log(`  CDP_URL=ws://127.0.0.1:${CDP_PORT} bun run test:e2e:shared`);
console.log('\nPress Ctrl+C to close.\n');

process.on('SIGINT', async () => {
  await browser.close();
  process.exit(0);
});

// Keep process alive until Ctrl+C
await new Promise(() => {});
