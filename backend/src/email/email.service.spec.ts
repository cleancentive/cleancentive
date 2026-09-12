import { describe, expect, test } from 'bun:test';

import { EmailService } from './email.service';
import { dedupeByEmail, toLocale } from '../user/notification-recipients';

interface SentMail {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
}

function makeEmailService() {
  const sent: SentMail[] = [];
  const service = Object.create(EmailService.prototype) as EmailService;
  Object.assign(service as unknown as Record<string, unknown>, {
    configService: { get: (_key: string, fallback?: string) => fallback ?? 'noreply@test.local' },
    logger: { error: () => {}, log: () => {}, warn: () => {} },
    transporter: {
      async sendMail(mail: SentMail) {
        sent.push(mail);
      },
    },
  });
  return { service, sent };
}

describe('EmailService.sendCommunityMessage locale grouping', () => {
  test('sends one message per locale and builds the payload per locale', async () => {
    // Regression: this rendered once with the *request* locale and bcc'd everyone,
    // so a German recipient got the sender's language and a background job always
    // sent English regardless of anyone's stored preference.
    const { service, sent } = makeEmailService();
    const localesSeen: string[] = [];

    await service.sendCommunityMessage(
      [
        { email: 'a@test.local', locale: 'en' },
        { email: 'b@test.local', locale: 'de' },
        { email: 'c@test.local', locale: 'de' },
      ],
      null,
      (locale) => {
        localesSeen.push(locale);
        return {
          subject: `subject-${locale}`,
          preheader: 'p',
          title: 't',
          body: 'b',
          disclosure: 'd',
        };
      },
    );

    expect(sent).toHaveLength(2);
    expect(localesSeen.sort()).toEqual(['de', 'en']);

    const german = sent.find((m) => m.subject === 'subject-de');
    expect(german?.bcc).toBe('b@test.local, c@test.local');
    expect(sent.find((m) => m.subject === 'subject-en')?.bcc).toBe('a@test.local');
  });

  test('CCs the sender exactly once even across several locale groups', async () => {
    const { service, sent } = makeEmailService();

    await service.sendCommunityMessage(
      [
        { email: 'a@test.local', locale: 'en' },
        { email: 'b@test.local', locale: 'de' },
        { email: 'c@test.local', locale: 'fr' },
      ],
      'sender@test.local',
      (locale) => ({ subject: locale, preheader: 'p', title: 't', body: 'b', disclosure: 'd' }),
    );

    expect(sent).toHaveLength(3);
    expect(sent.filter((m) => m.cc === 'sender@test.local')).toHaveLength(1);
  });

  test('deduplicates an address that appears in more than one group', async () => {
    const { service, sent } = makeEmailService();

    await service.sendCommunityMessage(
      [
        { email: 'dup@test.local', locale: 'en' },
        { email: 'DUP@test.local', locale: 'de' },
      ],
      null,
      (locale) => ({ subject: locale, preheader: 'p', title: 't', body: 'b', disclosure: 'd' }),
    );

    // First occurrence wins; the address must not be mailed twice.
    expect(sent).toHaveLength(1);
    expect(sent[0].bcc).toBe('dup@test.local');
  });

  test('sends nothing when there are no recipients and no sender', async () => {
    const { service, sent } = makeEmailService();
    await service.sendCommunityMessage([], null, () => ({
      subject: 's', preheader: 'p', title: 't', body: 'b', disclosure: 'd',
    }));
    expect(sent).toHaveLength(0);
  });

  test('still delivers to a lone sender when every recipient was filtered out', async () => {
    const { service, sent } = makeEmailService();
    await service.sendCommunityMessage([], 'sender@test.local', () => ({
      subject: 's', preheader: 'p', title: 't', body: 'b', disclosure: 'd',
    }));
    expect(sent).toHaveLength(1);
    expect(sent[0].cc).toBe('sender@test.local');
  });
});

describe('toLocale', () => {
  test('accepts supported locales and falls back otherwise', () => {
    expect(toLocale('de')).toBe('de');
    expect(toLocale('fr')).toBe('fr');
    // A null column, or a stale/unknown value, must not throw or leak through.
    expect(toLocale(null)).toBe('en');
    expect(toLocale(undefined)).toBe('en');
    expect(toLocale('klingon')).toBe('en');
  });
});

describe('dedupeByEmail', () => {
  test('normalizes case and whitespace, keeping the first locale seen', () => {
    expect(dedupeByEmail([
      { email: '  A@Test.local ', locale: 'de' },
      { email: 'a@test.local', locale: 'fr' },
    ])).toEqual([{ email: 'a@test.local', locale: 'de' }]);
  });
});
