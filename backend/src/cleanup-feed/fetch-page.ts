import { BadRequestException } from '@nestjs/common';

const USER_AGENT = 'CleanCentive-Feeds/1.0 (+https://cleancentive.org)';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Hosts that resolve inside our own network. Feeds are steward-registered, so
 * this is a guard against a careless URL rather than against an attacker with
 * a DNS record — see docs/cleanup-feeds.md.
 */
const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$)/i;

export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('url must be a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('url must be http or https');
  }
  if (PRIVATE_HOST.test(url.hostname)) {
    throw new BadRequestException('url must point at a public host');
  }
  return url;
}

/**
 * Spaces requests out. Sources are someone else's server — cleanuptour.ch asks
 * for a 10 second crawl delay — and a refresh should be a visitor, not a load.
 */
export class RequestPacer {
  private next = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async wait(): Promise<void> {
    const delay = this.next - this.now();
    if (delay > 0) {
      await this.sleep(delay);
    }
    this.next = this.now() + this.minIntervalMs;
  }
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) {
    throw new Error(`response is ${declared} bytes, over the ${MAX_BYTES} byte cap`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`response is ${buffer.byteLength} bytes, over the ${MAX_BYTES} byte cap`);
  }
  return new TextDecoder().decode(buffer);
}

async function request(url: string, accept: string, fetchImpl: typeof fetch): Promise<Response> {
  assertPublicHttpUrl(url);
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }
  return response;
}

export async function fetchHtml(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await request(url, 'text/html', fetchImpl);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) {
    throw new Error(`GET ${url} returned ${contentType || 'no content type'}, expected text/html`);
  }
  return readCapped(response);
}

export async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ body: T; headers: Headers }> {
  const response = await request(url, 'application/json', fetchImpl);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new Error(`GET ${url} returned ${contentType || 'no content type'}, expected JSON`);
  }
  return { body: JSON.parse(await readCapped(response)) as T, headers: response.headers };
}
