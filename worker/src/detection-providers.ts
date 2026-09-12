import OpenAI from 'openai';

// A single OpenAI-compatible vision endpoint. Mistral, OpenAI, Gemini and the
// EU hosters all speak the same wire format, so one client type covers them all.
export interface DetectionProvider {
  label: string;
  model: string;
  /** Host of the base URL, so cost from a fallback is attributed to its vendor. */
  host: string;
  client: OpenAI;
}

// Without an explicit timeout the SDK waits 600s, which parks a worker slot for
// ten minutes on a single hung request. 60s is well past a normal vision call.
const REQUEST_TIMEOUT_MS = 60_000;

export function providerHost(baseUrl: string | undefined): string {
  if (!baseUrl) return 'api.openai.com';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function buildProvider(label: string, apiKey: string, baseUrl: string | undefined, model: string): DetectionProvider {
  return {
    label,
    model,
    host: providerHost(baseUrl),
    client: new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      timeout: REQUEST_TIMEOUT_MS,
      // Retries are handled by falling through to the next provider and then by
      // BullMQ. SDK-level retries only hammer the same endpoint inside one held
      // worker slot, which is exactly wrong when the endpoint is rate limiting us.
      maxRetries: 0,
    }),
  };
}

/**
 * Reads the provider chain from the environment, primary first.
 *
 * Primary:   DETECTION_API_KEY / DETECTION_BASE_URL / DETECTION_MODEL
 * Fallbacks: DETECTION_FALLBACK_<n>_API_KEY / _BASE_URL / _MODEL, n starting at 1
 *
 * DETECTION_MODEL is required rather than defaulted: a default silently pointed
 * a non-OpenAI base URL at an OpenAI model name and wrote that false name into
 * detected_items.source_model.
 */
export function buildDetectionProviders(env: NodeJS.ProcessEnv = process.env): DetectionProvider[] {
  const providers: DetectionProvider[] = [];

  const primaryKey = env.DETECTION_API_KEY;
  if (primaryKey) {
    const model = env.DETECTION_MODEL;
    if (!model) {
      throw new Error('DETECTION_MODEL is required when DETECTION_API_KEY is set');
    }
    providers.push(buildProvider('primary', primaryKey, env.DETECTION_BASE_URL, model));
  }

  for (let n = 1; ; n += 1) {
    const apiKey = env[`DETECTION_FALLBACK_${n}_API_KEY`];
    if (!apiKey) break;

    const model = env[`DETECTION_FALLBACK_${n}_MODEL`];
    if (!model) {
      throw new Error(`DETECTION_FALLBACK_${n}_MODEL is required when DETECTION_FALLBACK_${n}_API_KEY is set`);
    }
    providers.push(buildProvider(`fallback-${n}`, apiKey, env[`DETECTION_FALLBACK_${n}_BASE_URL`], model));
  }

  return providers;
}

function headerValue(error: unknown, name: string): string | undefined {
  const headers = (error as { headers?: unknown }).headers;
  if (!headers) return undefined;

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }

  const record = headers as Record<string, string | undefined>;
  return record[name] ?? record[name.toLowerCase()];
}

/**
 * True when the provider reports a rate limit *ceiling* of zero — the account has
 * no entitlement at all, rather than having briefly exceeded one. Mistral returned
 * exactly this for nine days while the API key itself stayed valid, so it is worth
 * separating: retrying or backing off can never clear it, only billing can.
 */
export function isEntitlementWall(error: unknown): boolean {
  if ((error as { status?: number }).status !== 429) return false;

  for (const header of ['x-ratelimit-limit-req-minute', 'x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens']) {
    if (headerValue(error, header) === '0') return true;
  }

  return false;
}

/**
 * True when the failure is the provider's rather than ours, so the next provider
 * in the chain is worth trying. A 400/422 means we sent something bad and every
 * provider would reject it identically — failing over would just burn the chain.
 */
export function shouldTryNextProvider(error: unknown): boolean {
  const status = (error as { status?: number }).status;

  if (status === undefined) {
    // Connection errors, timeouts and aborts carry no status.
    return error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.APIConnectionTimeoutError;
  }

  return status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function describeProviderError(provider: DetectionProvider, error: unknown): string {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  const wall = isEntitlementWall(error) ? ' [no entitlement: rate limit ceiling is 0 — this needs billing, not a retry]' : '';

  return `${provider.label} (${provider.model}) failed with ${status ?? 'no status'}: ${message}${wall}`;
}
