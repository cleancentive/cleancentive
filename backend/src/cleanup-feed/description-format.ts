import type { CleanupFeedSettings } from './cleanup-feed.entity';
import type { ExternalCleanup } from './adapters/adapter';

/**
 * The description a mirrored cleanup carries: what the source wrote, and
 * nothing else. Where it came from and which team runs it are structural facts
 * the app already shows — repeating them in the text only made the description
 * say twice what the page says once, and put app plumbing inside a field people
 * are free to edit.
 */
export function formatDescription(external: ExternalCleanup): string {
  return external.body.trim();
}

export function formatName(external: ExternalCleanup, settings: CleanupFeedSettings): string {
  return `${settings.namePrefix ?? ''} ${external.title}`.replace(/\s+/g, ' ').trim();
}

/**
 * The names a cleanup for this source event could already be filed under: the
 * plain one, and the disambiguated forms a previous season would have taken.
 * Used to find an existing cleanup to adopt instead of creating a duplicate.
 */
export function candidateNames(external: ExternalCleanup, settings: CleanupFeedSettings): string[] {
  const base = formatName(external, settings);
  const year = external.startAt.getUTCFullYear();
  const day = external.startAt.toISOString().slice(0, 10);
  return [base, `${base} (${year})`, `${base} (${day})`];
}
