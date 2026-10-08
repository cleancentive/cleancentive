import { createHash, randomBytes } from 'node:crypto';

export type SecretTokenPrefix = 'cc_pat_' | 'cc_live_';

const RANDOM_BYTES = 32;
const DISPLAY_RANDOM_CHARS = 8;

export interface GeneratedSecretToken {
  /** Shown to the caller exactly once; never stored. */
  plaintext: string;
  /** Enough of the token to tell it apart in a list, not enough to use it. */
  displayPrefix: string;
  hash: string;
}

/**
 * A bearer secret that is stored only as a hash. The fixed prefix makes a
 * leaked token recognisable, to a reader and to a secret scanner alike; the
 * display prefix lets its owner identify it later without seeing it again.
 */
export function generateSecretToken(prefix: SecretTokenPrefix): GeneratedSecretToken {
  const plaintext = prefix + randomBytes(RANDOM_BYTES).toString('base64url');
  return {
    plaintext,
    displayPrefix: plaintext.slice(0, prefix.length + DISPLAY_RANDOM_CHARS),
    hash: hashSecretToken(plaintext),
  };
}

export function hashSecretToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
