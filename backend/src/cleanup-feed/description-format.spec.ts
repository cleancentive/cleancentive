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
  test('is the source text and nothing else', () => {
    // Where it came from and who runs it are shown by the app; putting them in
    // the description made the page say the same thing twice, inside a field
    // people are free to edit.
    expect(formatDescription(external())).toBe('Am Freitag 18. September findet der nationale Clean-Up-Day statt.');
  });

  test('keeps the links the source wrote', () => {
    const withLink = external({ body: 'Treffpunkt: [Gondelbahn](https://maps.app.goo.gl/oVvS)' });
    expect(formatDescription(withLink)).toBe('Treffpunkt: [Gondelbahn](https://maps.app.goo.gl/oVvS)');
  });

  test('a source with no text yields nothing to show', () => {
    expect(formatDescription(external({ body: '' }))).toBe('');
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
