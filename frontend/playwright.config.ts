import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 *
 * These tests run against the real development environment:
 * - App (frontend + /api): https://cleancentive.local
 * - Backend API, direct:   http://localhost:3000/api/v1
 * - Mailpit:               http://localhost:8025
 *
 * Prerequisites:
 * 1. Start everything: bun dev  (from the repo root)
 * 2. Run tests: bun run test:e2e
 *
 * Sign-in specs share one Mailpit inbox, so run them with --workers=1 or they
 * delete each other's magic links.
 *
 * Shared browser mode (human + agent):
 * 1. bun run browser:launch   (in one terminal)
 * 2. bun run test:e2e:shared  (in another terminal)
 */

// When CDP_URL is set, tests run against a shared browser (see browser:launch)
const isCdpMode = !!process.env.CDP_URL;

export default defineConfig({
  testDir: './e2e',

  /* Maximum time one test can run for */
  timeout: 30 * 1000,

  /* Run tests in files in parallel (disabled in shared browser mode to avoid racing) */
  fullyParallel: !isCdpMode,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI or when using a shared browser */
  workers: isCdpMode ? 1 : (process.env.CI ? 1 : undefined),
  
  /* Reporter to use */
  reporter: 'html',
  
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`.
     *
     * The app's dev URL is the Caddy one, not the Vite port: that is where
     * HTTPS, geolocation permissions and Secure cookies behave as they do in
     * production. It also has to match the host magic links point at, or every
     * sign-in looks like it came from a different device — localStorage, and so
     * the record of which sign-in this browser started, is per origin. */
    baseURL: 'https://cleancentive.local',

    /* mkcert's CA is installed locally, but a fresh CI checkout has no trust
     * store for it. */
    ignoreHTTPSErrors: true,
    
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Do not start dev server - tests expect services to be running */
  webServer: undefined,
});
