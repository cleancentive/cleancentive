import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * The origins this API trusts: the ones that may send credentials, and the
 * only hosts a magic link may point at.
 *
 * Both uses share one list on purpose. The magic-link URL used to be built from
 * the request's own Origin header, so `POST /auth/magic-link` with
 * `Origin: https://evil.example` mailed the victim a genuine Cleancentive email
 * whose button pointed at the attacker's host, token and all. CORS had the
 * mirror-image problem: with FRONTEND_URL unset it fell back to reflecting any
 * origin, with credentials.
 *
 * Any other origin may still call the API, without credentials. Every
 * credential here travels in an Authorization header the caller sets itself,
 * never in a cookie, so a page on a foreign origin can only present a token it
 * already holds. That is what lets third-party clients exist at all.
 */

const DEV_FALLBACK_ORIGIN = 'https://cleancentive.local';

function isRelaxedEnvironment(): boolean {
  const env = process.env.NODE_ENV;
  return env === undefined || env === 'development' || env === 'test';
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/**
 * CORS_ORIGINS wins when set (it can list more than one), otherwise the single
 * FRONTEND_URL. Outside dev and test an empty list is a configuration error:
 * starting anyway is what produced the wildcard-with-credentials behaviour.
 */
export function allowedOrigins(): string[] {
  const configured = parseList(process.env.CORS_ORIGINS);
  if (configured.length > 0) return configured;

  const frontendUrl = parseList(process.env.FRONTEND_URL);
  if (frontendUrl.length > 0) return frontendUrl;

  if (isRelaxedEnvironment()) return [DEV_FALLBACK_ORIGIN];

  throw new Error(
    'No allowed origins configured. Set CORS_ORIGINS (comma-separated) or FRONTEND_URL.',
  );
}

const EXPOSED_HEADERS = ['x-session-token'];

/**
 * CORS for one request. The Origin is always reflected; what the trusted list
 * decides is whether the browser may also send credentials with it.
 */
export function corsOptionsFor(origin: string | undefined, trustedOrigins: string[]): CorsOptions {
  const isTrusted = origin !== undefined && trustedOrigins.includes(origin.replace(/\/$/, ''));
  return { origin: true, credentials: isTrusted, exposedHeaders: EXPOSED_HEADERS };
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins().includes(origin.replace(/\/$/, ''));
}

/**
 * Where a link mailed to this requester should point. An allowlisted Origin is
 * honoured so a dev on a second hostname still gets a usable link; anything
 * else falls back to the canonical frontend URL rather than being trusted.
 */
export function resolveFrontendUrl(origin?: string): string {
  if (isAllowedOrigin(origin)) return origin.replace(/\/$/, '');
  return allowedOrigins()[0];
}
