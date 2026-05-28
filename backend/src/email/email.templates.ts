/**
 * Email templates loaded from .md files in templates/.
 *
 * The markdown files are human-readable and previewable in any IDE.
 * This module reads them once at startup and interpolates {{variables}}
 * at render time.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

function loadTemplate(name: string): string {
  return readFileSync(join(__dirname, 'templates', `${name}.md`), 'utf-8');
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
): string {
  return interpolate(loadTemplate('magic-link'), {
    link,
    browser: requestMetadata?.browser ?? 'Unknown browser',
    location: requestMetadata?.location ?? 'Unknown location',
    requestedAt: requestMetadata?.requestedAt ?? '',
  });
}

export function recoveryMd(link: string): string {
  return interpolate(loadTemplate('recovery'), { link });
}

export function mergeWarningMd(link: string, requesterNickname: string): string {
  return interpolate(loadTemplate('merge-warning'), { link, requesterNickname });
}

export function cleanupInviteMd(payload: {
  title: string;
  intro: string;
  when: string;
  locationLine: string;
  cleanupLink: string;
  feedUrl: string;
  profileLink: string;
}): string {
  return interpolate(loadTemplate('cleanup-invite'), payload);
}

export function communityMessageMd(payload: {
  preheader: string;
  title: string;
  body: string;
  disclosure: string;
}): string {
  return interpolate(loadTemplate('community-message'), {
    preheader: payload.preheader.replace(/"/g, '\\"'),
    title: payload.title,
    body: payload.body,
    disclosure: payload.disclosure,
  });
}
