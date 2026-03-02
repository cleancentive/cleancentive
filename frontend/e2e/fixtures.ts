/**
 * CDP-aware Playwright fixtures for shared browser mode.
 *
 * When CDP_URL is set, the `page` fixture connects to the existing browser
 * launched by `bun run browser:launch` instead of starting a new one.
 *
 * Usage in tests:
 *   import { test, expect } from './fixtures';
 *   // (instead of importing from '@playwright/test')
 *
 * Shared browser workflow:
 *   Terminal 1: bun run browser:launch
 *   Terminal 2: bun run test:e2e:shared
 */
import { test as base, chromium } from '@playwright/test';
import type { Page } from '@playwright/test';

export const test = base.extend<{ page: Page }>({
  page: async ({}, use) => {
    const cdpUrl = process.env.CDP_URL;

    if (!cdpUrl) {
      // No shared browser — fall back to a standard Playwright-managed browser
      const browser = await chromium.launch({ headless: false });
      const context = await browser.newContext();
      const page = await context.newPage();
      await use(page);
      await context.close();
      await browser.close();
      return;
    }

    // Connect to the shared browser started by browser:launch
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    // Close the isolated context but leave the shared browser running
    await context.close();
  },
});

export { expect } from '@playwright/test';
