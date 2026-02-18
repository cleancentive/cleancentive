import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 * 
 * These tests run against the real development environment:
 * - Frontend: http://localhost:5173
 * - Backend API: http://localhost:3000/api/v1
 * - Mailpit: http://localhost:8025
 * 
 * Prerequisites:
 * 1. Start Docker services: cd infrastructure && docker compose -f docker-compose.dev.yml up -d
 * 2. Start backend: cd backend && bun run dev
 * 3. Start frontend: cd frontend && bun run dev
 * 4. Run tests: bun run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  
  /* Maximum time one test can run for */
  timeout: 30 * 1000,
  
  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,
  
  /* Reporter to use */
  reporter: 'html',
  
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: 'http://localhost:5173',
    
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
