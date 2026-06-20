/**
 * Preflight: ensure Playwright Chromium is installed for `bun browse`.
 *
 * Playwright's stock error message tells you to run `npx playwright install`,
 * which is wrong in this Bun monorepo (no npx on PATH, and @playwright/test
 * lives in the frontend workspace, not the root). Catch the missing-browser
 * case early and print instructions that actually work here.
 *
 * The check is delegated to Playwright itself (via a short Bun script run
 * inside frontend/) — it knows which Chromium revision matches the installed
 * @playwright/test version. A naive filesystem check on ~/.cache/ms-playwright
 * is too lenient: a stale chromium-* from a different Playwright version will
 * still cause `bun browse` to fail with the misleading hint.
 *
 * We don't auto-install: Playwright sometimes also needs OS libs that
 * require sudo, and per AGENTS.md we don't auto-sudo on Linux — we print
 * the command.
 *
 * Idempotent — silent no-op when Playwright reports its Chromium is ready.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const FRONTEND = resolve(REPO_ROOT, 'frontend');

const probe = `
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
try {
  process.exit(existsSync(chromium.executablePath()) ? 0 : 1);
} catch {
  process.exit(1);
}
`;

const result = spawnSync('bun', ['-e', probe], {
  cwd: FRONTEND,
  stdio: ['ignore', 'ignore', 'ignore'],
});

if (result.status === 0) process.exit(0);

console.error('');
console.error('Playwright Chromium is not installed (or the cached build does');
console.error("not match the @playwright/test version in frontend/).");
console.error('`bun browse` needs it to launch the shared dev browser.');
console.error('');
console.error('Install it from the frontend workspace:');
console.error('');
console.error('  cd frontend && bunx playwright install chromium');
console.error('');
console.error('If Playwright reports missing system libraries (libicu, libnss, etc.),');
console.error('it will print an `apt-get install …` line — run that with sudo.');
console.error('');
process.exit(1);
