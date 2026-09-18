import { describe, expect, test } from 'bun:test';

import { formatDescription, formatName, candidateNames } from './description-format';
import type { CleanupFeedSettings } from './cleanup-feed.entity';
import type { ExternalCleanup } from './adapters/adapter';

function settings(overrides: Partial<CleanupFeedSettings> = {}): CleanupFeedSettings {
  return { language: 'de', horizon: 'upcoming', namePrefix: 'Clean-Up Tour', ...overrides };
}

function external(overrides: Partial<ExternalCleanup> = {}): ExternalCleanup {
  return {
    externalId: '943',
    title: 'Zermatt',
    body: 'Am Freitag 18. September findet der nationale Clean-Up-Day statt.',
    url: 'https://cleanuptour.ch/de/event/zermatt/',
    registrationUrl: 'https://forms.gle/abc',
    startAt: new Date('2026-09-18T06:00:00Z'),
    endAt: new Date('2026-09-18T13:30:00Z'),
    address: 'Wiestistrasse, 44, Zermatt',
    latitude: null,
    longitude: null,
    locationName: 'Zermatt',
    version: '2026-08-13T07:35:23',
    ...overrides,
  };
}

describe('formatDescription', () => {
  test('keeps the source text and says where to sign up', () => {
    const text = formatDescription(external(), settings(), 'Summit Foundation');
    expect(text).toBe(
      [
        'Am Freitag 18. September findet der nationale Clean-Up-Day statt.',
        '',
        'Anmeldung: https://forms.gle/abc',
        'Details: https://cleanuptour.ch/de/event/zermatt/',
        'Organisiert von Summit Foundation',
      ].join('\n'),
    );
  });

  test('omits the registration line when the source offers no form', () => {
    const text = formatDescription(external({ registrationUrl: null }), settings(), 'Summit Foundation');
    expect(text).not.toContain('Anmeldung');
    expect(text).toContain('Details: https://cleanuptour.ch/de/event/zermatt/');
  });

  test('follows the feed language', () => {
    const french = formatDescription(external(), settings({ language: 'fr' }), 'Summit Foundation');
    expect(french).toContain('Inscription: https://forms.gle/abc');
    expect(french).toContain('Organisé par Summit Foundation');

    const english = formatDescription(external(), settings({ language: 'en' }), 'Summit Foundation');
    expect(english).toContain('Registration: https://forms.gle/abc');
    expect(english).toContain('Organised by Summit Foundation');
  });

  test('a source with no body still gets the links', () => {
    const text = formatDescription(external({ body: '' }), settings(), 'Summit Foundation');
    expect(text.startsWith('Anmeldung:')).toBe(true);
  });
});

describe('formatName', () => {
  test('applies the feed prefix', () => {
    expect(formatName(external(), settings())).toBe('Clean-Up Tour Zermatt');
  });

  test('without a prefix the source title stands alone', () => {
    expect(formatName(external(), settings({ namePrefix: '' }))).toBe('Zermatt');
  });
});

describe('candidateNames', () => {
  test('offers the plain name and the disambiguated forms', () => {
    expect(candidateNames(external(), settings())).toEqual([
      'Clean-Up Tour Zermatt',
      'Clean-Up Tour Zermatt (2026)',
      'Clean-Up Tour Zermatt (2026-09-18)',
    ]);
  });
});
