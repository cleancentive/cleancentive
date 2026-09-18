/**
 * What a signed token is allowed to be used for.
 *
 * Every token this app issues is signed with the same secret, and
 * JwtStrategy.validate() accepted anything with a `sub`. So a magic link, an
 * add-email verification link, a merge confirmation and a recovery link were
 * all valid bearer sessions. Two consequences: any leaked link was a live
 * session for as long as it was valid, and an add-email token — which is
 * delivered to whatever address the requester typed, with `sub` set to the
 * *requester* — let its recipient act as that requester.
 *
 * Tokens now say what they are. Sessions carry `typ`, email links carry
 * `purpose`, and each side only accepts its own kind.
 */

export type TokenType = 'session' | 'guest';
export type TokenPurpose = 'magic-link' | 'add-email' | 'merge-confirm';

export interface TokenPayload {
  sub?: string;
  typ?: string;
  purpose?: string;
  email?: string;
  [claim: string]: unknown;
}

const SESSION_TYPES = new Set<string>(['session', 'guest']);

/**
 * Tokens issued before this change carry neither claim. Rejecting them would
 * sign everyone out of a year-long session for a problem they cannot see, so
 * they are still accepted; what they cannot be is a token that says it is
 * something else. Drop this once the last pre-2026-09 token has expired.
 */
function isLegacySession(payload: TokenPayload): boolean {
  return payload.typ === undefined && payload.purpose === undefined;
}

export function isSessionPayload(payload: TokenPayload | null | undefined): boolean {
  if (!payload?.sub) return false;
  if (payload.purpose !== undefined) return false;
  if (payload.typ !== undefined) return SESSION_TYPES.has(payload.typ);
  return isLegacySession(payload);
}

export function isGuestPayload(payload: TokenPayload | null | undefined): boolean {
  return payload?.typ === 'guest';
}

/**
 * A magic link, including one already sitting in an inbox when this shipped:
 * those have no `purpose` but do carry the `email` claim that only sign-in
 * links have, which is what tells them apart from a session token.
 */
export function isMagicLinkPayload(payload: TokenPayload | null | undefined): boolean {
  if (!payload?.sub) return false;
  if (payload.purpose !== undefined) return payload.purpose === 'magic-link';
  return payload.typ === undefined && typeof payload.email === 'string';
}

export function hasPurpose(payload: TokenPayload | null | undefined, purpose: TokenPurpose): boolean {
  return payload?.purpose === purpose;
}
