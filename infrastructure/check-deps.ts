/**
 * Preflight: ensure workspace dependencies are installed.
 *
 * Bun workspaces hoist deps to the repo root node_modules. Without it,
 * anything that imports a third-party package (e.g. the worker importing
 * bullmq) fails with "Cannot find package". This trips up fresh clones
 * and lock-file pulls.
 *
 * Runs `bun install --frozen-lockfile` when:
 *   - root node_modules is missing, or
 *   - bun.lock has been modified more recently than node_modules
 *     (someone pulled a branch with updated deps).
 *
 * --frozen-lockfile is deliberate: never mutate bun.lock silently. If the
 * lock and a package.json drift, we exit non-zero and tell the dev to run
 * `bun install` manually.
 *
 * No-op (~130ms) when already in sync. Idempotent — safe to run on every
 * `bun dev` / `bun browse`.
 */
import { existsSync, statSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const LOCK = resolve(REPO_ROOT, 'bun.lock');
const NODE_MODULES = resolve(REPO_ROOT, 'node_modules');

function needsInstall(): boolean {
  if (!existsSync(NODE_MODULES)) return true;
  try {
    return statSync(LOCK).mtimeMs > statSync(NODE_MODULES).mtimeMs;
  } catch {
    return true;
  }
}

if (!needsInstall()) process.exit(0);

console.log('Installing workspace dependencies (bun install --frozen-lockfile)…');
const res = spawnSync('bun', ['install', '--frozen-lockfile'], {
  stdio: 'inherit',
  cwd: REPO_ROOT,
});
if (res.status !== 0) {
  console.error('');
  console.error('Dependency install failed. If bun.lock is out of sync with');
  console.error('a package.json, run `bun install` manually to regenerate it.');
  process.exit(res.status ?? 1);
}

const now = new Date();
utimesSync(NODE_MODULES, now, now);
process.exit(0);
