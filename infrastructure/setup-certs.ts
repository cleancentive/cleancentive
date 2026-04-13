/**
 * Preflight: ensure mkcert is installed, the local CA is trusted, and dev
 * certs exist.
 *
 * Issues one trusted cert covering `cleancentive.local` and `*.cleancentive.local`
 * so Caddy can terminate TLS with a cert the host browser already trusts.
 * Copies mkcert's rootCA.pem alongside it so containers (Outline) can mount
 * it and trust our CA when making server-side calls.
 *
 * On a fresh macOS machine with Homebrew present this script is end-to-end
 * automatic (the user only sees a sudo prompt from `mkcert -install`). On
 * Linux we print exact commands — too many distro variants to auto-install
 * safely. Idempotent — safe to run on every `bun dev`.
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CERTS_DIR = resolve(SCRIPT_DIR, 'certs');
const CERT_PATH = join(CERTS_DIR, 'cleancentive.local.pem');
const KEY_PATH = join(CERTS_DIR, 'cleancentive.local-key.pem');
const ROOT_CA_COPY = join(CERTS_DIR, 'rootCA.pem');

const HOSTS = ['cleancentive.local', '*.cleancentive.local'];

function have(bin: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }).status === 0;
}

function run(cmd: string, args: string[], opts: { inherit?: boolean } = {}): { stdout: string; status: number } {
  const res = spawnSync(cmd, args, opts.inherit ? { stdio: 'inherit' } : { encoding: 'utf-8' });
  return { stdout: ('stdout' in res && res.stdout ? String(res.stdout).trim() : ''), status: res.status ?? 1 };
}

function promptYes(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = (prompt(`${question} [Y/n]`, 'y') ?? '').trim().toLowerCase();
  return answer === '' || answer === 'y' || answer === 'yes';
}

function installMkcertMacOS(): boolean {
  if (!have('brew')) {
    console.error('Homebrew not found. Install brew first: https://brew.sh');
    return false;
  }
  if (!promptYes('Install mkcert + nss via `brew install mkcert nss`?')) return false;
  return run('brew', ['install', 'mkcert', 'nss'], { inherit: true }).status === 0;
}

function printLinuxInstallHint(): void {
  console.error('');
  console.error('`mkcert` is required to issue dev TLS certs.');
  console.error('Install it for your distro (examples):');
  console.error('  Debian/Ubuntu: sudo apt install libnss3-tools && download mkcert from');
  console.error('                 https://github.com/FiloSottile/mkcert/releases');
  console.error('  Arch:          sudo pacman -S mkcert nss');
  console.error('  Fedora:        sudo dnf install mkcert nss-tools');
  console.error('Then run: mkcert -install');
  console.error('');
}

function ensureMkcert(): boolean {
  if (have('mkcert')) return true;
  if (process.platform === 'darwin') {
    console.log('');
    console.log('mkcert not found — needed to issue trusted dev TLS certs.');
    return installMkcertMacOS();
  }
  printLinuxInstallHint();
  return false;
}

function caRootPath(): string | null {
  const { stdout, status } = run('mkcert', ['-CAROOT']);
  return status === 0 && stdout ? stdout : null;
}

function ensureCaInstalled(): boolean {
  const root = caRootPath();
  if (root && existsSync(join(root, 'rootCA.pem'))) return true;
  console.log('');
  console.log('Installing mkcert local CA (adds a root cert to your system trust store).');
  console.log('You may be prompted for your password.');
  return run('mkcert', ['-install'], { inherit: true }).status === 0;
}

function certStillValid(): boolean {
  if (!existsSync(CERT_PATH) || !existsSync(KEY_PATH)) return false;
  if (!have('openssl')) return true;
  const { stdout, status } = run('openssl', ['x509', '-enddate', '-noout', '-in', CERT_PATH]);
  if (status !== 0) return false;
  const match = stdout.match(/notAfter=(.+)/);
  if (!match) return true;
  const expiry = Date.parse(match[1]);
  return Number.isFinite(expiry) && expiry > Date.now() + 7 * 24 * 60 * 60 * 1000;
}

function issueCert(): boolean {
  mkdirSync(CERTS_DIR, { recursive: true });
  const result = spawnSync(
    'mkcert',
    ['-cert-file', CERT_PATH, '-key-file', KEY_PATH, ...HOSTS],
    { stdio: 'inherit' },
  );
  return result.status === 0 && existsSync(CERT_PATH) && existsSync(KEY_PATH);
}

function rootCaUpToDate(caRoot: string): boolean {
  const src = join(caRoot, 'rootCA.pem');
  if (!existsSync(src) || !existsSync(ROOT_CA_COPY)) return false;
  try {
    return readFileSync(src).equals(readFileSync(ROOT_CA_COPY));
  } catch {
    return false;
  }
}

function copyRootCa(caRoot: string): boolean {
  const src = join(caRoot, 'rootCA.pem');
  if (!existsSync(src)) return false;
  try {
    mkdirSync(CERTS_DIR, { recursive: true });
    copyFileSync(src, ROOT_CA_COPY);
    return true;
  } catch {
    return false;
  }
}

if (!ensureMkcert()) {
  console.error('Cannot continue without mkcert. See instructions above.');
  process.exit(1);
}

if (!ensureCaInstalled()) {
  console.error('Failed to install mkcert local CA. Run `mkcert -install` manually, then retry.');
  process.exit(1);
}

const caRoot = caRootPath();
if (!caRoot) {
  console.error('mkcert -CAROOT returned nothing. Is mkcert working?');
  process.exit(1);
}

let issued = false;
if (!certStillValid()) {
  console.log(`Issuing dev TLS cert for ${HOSTS.join(', ')}...`);
  if (!issueCert()) {
    console.error('mkcert failed to issue the cert.');
    process.exit(1);
  }
  issued = true;
}

if (!rootCaUpToDate(caRoot)) {
  if (!copyRootCa(caRoot)) {
    console.error(`Failed to copy ${caRoot}/rootCA.pem to ${ROOT_CA_COPY}`);
    process.exit(1);
  }
  if (!issued) console.log(`Updated ${ROOT_CA_COPY}.`);
}

process.exit(0);
