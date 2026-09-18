/**
 * JWT configuration, in one place so the signing side and the verifying side
 * cannot drift apart.
 *
 * The secret used to be `process.env.JWT_SECRET || 'default-secret-change-in-production'`
 * in both auth.module.ts and jwt.strategy.ts. That fallback is published in a
 * public repository: any deployment that forgot the variable would happily
 * accept tokens minted by anyone, for any user id, steward accounts included.
 * Failing to boot is the only safe response — a silent fallback is what made
 * the problem invisible in the first place.
 */

const KNOWN_DEFAULTS = new Set([
  'default-secret-change-in-production',
  'your-secret-key-change-in-production',
  'change-me',
  'secret',
]);

/**
 * Sessions stay long-lived: people may take part once a season, and being
 * signed out between two cleanups is a worse outcome than the risk it buys
 * back. A stolen token is a revocation problem, not a lifetime one.
 *
 * Deliberately not read from JWT_EXPIRES_IN. That variable has been sitting
 * unread in .env.example at 7d, so honouring it would quietly cut every
 * session from a year to a week wherever the example was copied.
 */
export const SESSION_TTL = '365d';

/** Guests cannot sign in again, so their token has to outlive a long gap. */
export const GUEST_SESSION_TTL = '365d';

/** Long enough to survive a slow inbox, short enough to matter if forwarded. */
export const MAGIC_LINK_TTL = '24h';

function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test';
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (isTestEnvironment()) {
    return secret || 'test-only-secret';
  }

  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Every session token would be signed with a value ' +
        'published in the repository. Run `bun dev` to generate one locally, or ' +
        'set it from cleancentive-private in production.',
    );
  }

  if (KNOWN_DEFAULTS.has(secret)) {
    throw new Error(
      `JWT_SECRET is set to the well-known placeholder "${secret}". Anyone reading ` +
        'the repository could mint tokens for any account. Generate a random value.',
    );
  }

  return secret;
}
