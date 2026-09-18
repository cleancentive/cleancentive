import type { Locale } from '@cleancentive/shared';
import type { CleanupFeedSettings } from './cleanup-feed.entity';
import type { ExternalCleanup } from './adapters/adapter';

interface FooterStrings {
  registration: string;
  details: string;
  organizedBy: string;
}

const FOOTERS: Record<Locale, FooterStrings> = {
  en: { registration: 'Registration', details: 'Details', organizedBy: 'Organised by' },
  de: { registration: 'Anmeldung', details: 'Details', organizedBy: 'Organisiert von' },
  fr: { registration: 'Inscription', details: 'Détails', organizedBy: 'Organisé par' },
};

/**
 * The description a mirrored cleanup carries: the source's own text, then where
 * to actually sign up. Joining the cleanup here is not a registration with the
 * organizer, so the link has to be in the text people read.
 */
export function formatDescription(
  external: ExternalCleanup,
  settings: CleanupFeedSettings,
  teamName: string,
): string {
  const strings = FOOTERS[settings.language] ?? FOOTERS.en;
  const footer: string[] = [];
  if (external.registrationUrl) {
    footer.push(`${strings.registration}: ${external.registrationUrl}`);
  }
  footer.push(`${strings.details}: ${external.url}`);
  footer.push(`${strings.organizedBy} ${teamName}`);

  return [external.body.trim(), footer.join('\n')].filter(Boolean).join('\n\n');
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
