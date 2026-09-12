const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The useful half of an error body.
 *
 * These messages land on the steward page verbatim, and "This API key is
 * restricted to only send emails" is worth reading where the JSON wrapping it
 * is not.
 */
function describeBody(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.message ?? parsed?.error?.message ?? parsed?.error;
    if (typeof message === 'string') return message;
  } catch {
    // Not JSON — the raw text is the best we have.
  }
  return body.slice(0, 200);
}

/**
 * A JSON GET that cannot hang a page load.
 *
 * Every cost source is a third party we do not control, and the dashboard has
 * to render even when one of them is down — so the timeout is not optional and
 * a non-2xx is an error with the body attached, not a silent empty result.
 */
export async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`GET ${new URL(url).pathname} returned ${response.status}: ${describeBody(await response.text())}`);
  }
  return (await response.json()) as T;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`POST ${new URL(url).pathname} returned ${response.status}: ${describeBody(await response.text())}`);
  }
  return (await response.json()) as T;
}
