/**
 * Preflight: ensure the backend has a real JWT secret.
 *
 * The backend used to fall back to a hard-coded secret when JWT_SECRET was
 * missing — a value anyone could read in the public repository and use to mint
 * a session token for any account. It now refuses to start without one, so a
 * fresh clone needs a secret before `bun dev` works.
 *
 * Creates backend/.env from .env.example when absent, then fills JWT_SECRET
 * with 48 random bytes if it is empty or still the example placeholder.
 *
 * No-op once a real secret is present. Idempotent — safe on every `bun dev`.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const ENV_FILE = resolve(REPO_ROOT, 'backend/.env');
const ENV_EXAMPLE = resolve(REPO_ROOT, 'backend/.env.example');

const PLACEHOLDERS = new Set([
  '',
  'your-secret-key-change-in-production',
  'default-secret-change-in-production',
  'change-me',
  'secret',
]);

if (!existsSync(ENV_FILE)) {
  if (!existsSync(ENV_EXAMPLE)) {
    console.error('backend/.env.example is missing — cannot bootstrap backend/.env');
    process.exit(1);
  }
  copyFileSync(ENV_EXAMPLE, ENV_FILE);
  console.log('Created backend/.env from .env.example');
}

const contents = readFileSync(ENV_FILE, 'utf8');
const match = contents.match(/^JWT_SECRET=(.*)$/m);
const current = match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';

if (!PLACEHOLDERS.has(current)) process.exit(0);

const secret = randomBytes(48).toString('base64url');
const line = `JWT_SECRET=${secret}`;

writeFileSync(
  ENV_FILE,
  match ? contents.replace(/^JWT_SECRET=.*$/m, line) : `${contents.trimEnd()}\n${line}\n`,
);

console.log('Generated a random JWT_SECRET in backend/.env (existing local sessions are now invalid)');
