/**
 * Preflight: ensure the dev hostnames resolve to the loopback address.
 *
 * The browser needs to reach Caddy at `cleancentive.local` (+ subdomains) so that
 * OIDC/SSO flows use the same URL that containers use internally. `host.docker.internal`
 * also lives here because Caddy proxies upstreams through it.
 *
 * Offers to fix via sudo when running interactively; otherwise prints the command.
 * Idempotent — safe to run on every `bun dev`.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HOSTS_FILE = '/etc/hosts';
const REQUIRED_HOSTS = [
  'cleancentive.local',
  'wiki.cleancentive.local',
  'analytics.cleancentive.local',
  'host.docker.internal',
];

function missingHosts(): string[] {
  const content = readFileSync(HOSTS_FILE, 'utf-8');
  const lines = content
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => /^127\.\d+\.\d+\.\d+\s/.test(l));
  const mapped = new Set<string>();
  for (const line of lines) {
    for (const host of line.split(/\s+/).slice(1)) mapped.add(host);
  }
  return REQUIRED_HOSTS.filter((h) => !mapped.has(h));
}

function appendViaSudo(line: string): boolean {
  console.log(`Running: echo '${line}' | sudo tee -a ${HOSTS_FILE}`);
  const result = spawnSync(
    'sudo',
    ['sh', '-c', `echo '${line}' >> ${HOSTS_FILE}`],
    { stdio: 'inherit' },
  );
  return result.status === 0;
}

const missing = missingHosts();
if (missing.length === 0) process.exit(0);

const line = `127.0.0.1 ${REQUIRED_HOSTS.join(' ')}`;

console.log('');
console.log(`Missing ${HOSTS_FILE} entries: ${missing.join(', ')}`);
console.log('These are required so the browser can reach dev services via');
console.log('the same hostnames used inside Docker (OIDC, wiki, analytics).');
console.log('');

if (process.stdin.isTTY) {
  const answer = (prompt('Add them now via sudo?', 'y') ?? '').trim().toLowerCase();
  if (answer === '' || answer === 'y' || answer === 'yes') {
    if (appendViaSudo(line) && missingHosts().length === 0) {
      console.log(`Added to ${HOSTS_FILE}.`);
      process.exit(0);
    }
    console.error(`Failed to update ${HOSTS_FILE}.`);
  }
}

console.error('');
console.error('Run this once to fix manually, then retry `bun dev`:');
console.error(`  echo '${line}' | sudo tee -a ${HOSTS_FILE}`);
console.error('');
process.exit(1);
