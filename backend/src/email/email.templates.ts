/**
 * Email templates loaded from .md files in templates/.
 *
 * The markdown files are human-readable and previewable in any IDE.
 * This module reads them once at startup and interpolates {{variables}}
 * at render time.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_LOCALE, type Locale } from '@cleancentive/shared';

// Resolve the locale-specific template (`name.de.md`) and fall back to the
// English base file (`name.md`) when a translation is missing.
function loadTemplate(name: string, locale: Locale = DEFAULT_LOCALE): string {
  const dir = join(__dirname, 'templates');
  const localized = join(dir, `${name}.${locale}.md`);
  if (locale !== DEFAULT_LOCALE && existsSync(localized)) {
    return readFileSync(localized, 'utf-8');
  }
  return readFileSync(join(dir, `${name}.md`), 'utf-8');
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// Templates are re-read on each call so dev edits to .md files take effect
// without restarting the backend (`bun --watch` only triggers on .ts changes).
// Cost is a tiny readFileSync per email — negligible vs SMTP latency.

export function magicLinkMd(
  link: string,
  requestMetadata?: { browser: string; location: string; requestedAt: string },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return interpolate(loadTemplate('magic-link', locale), {
    link,
    browser: requestMetadata?.browser ?? 'Unknown browser',
    location: requestMetadata?.location ?? 'Unknown location',
    requestedAt: requestMetadata?.requestedAt ?? '',
  });
}

export function recoveryMd(link: string, locale: Locale = DEFAULT_LOCALE): string {
  return interpolate(loadTemplate('recovery', locale), { link });
}

export function mergeWarningMd(
  link: string,
  requesterNickname: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return interpolate(loadTemplate('merge-warning', locale), { link, requesterNickname });
}

export function cleanupInviteMd(
  payload: {
    title: string;
    intro: string;
    when: string;
    locationLine: string;
    cleanupLink: string;
    feedUrl: string;
    profileLink: string;
  },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return interpolate(loadTemplate('cleanup-invite', locale), payload);
}

export function communityMessageMd(
  payload: {
    preheader: string;
    title: string;
    body: string;
    disclosure: string;
  },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return interpolate(loadTemplate('community-message', locale), {
    preheader: payload.preheader.replace(/"/g, '\\"'),
    title: payload.title,
    body: payload.body,
    disclosure: payload.disclosure,
  });
}
