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

const magicLinkTpl = loadTemplate('magic-link');
const recoveryTpl = loadTemplate('recovery');
const mergeWarningTpl = loadTemplate('merge-warning');
const communityMessageTpl = loadTemplate('community-message');

export function magicLinkMd(link: string): string {
  return interpolate(magicLinkTpl, { link });
}

export function recoveryMd(link: string): string {
  return interpolate(recoveryTpl, { link });
}

export function mergeWarningMd(link: string, requesterNickname: string): string {
  return interpolate(mergeWarningTpl, { link, requesterNickname });
}

export function communityMessageMd(payload: {
  preheader: string;
  title: string;
  body: string;
  disclosure: string;
}): string {
  return interpolate(communityMessageTpl, {
    preheader: payload.preheader.replace(/"/g, '\\"'),
    title: payload.title,
    body: payload.body,
    disclosure: payload.disclosure,
  });
}
