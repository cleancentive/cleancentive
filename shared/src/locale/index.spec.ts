import { describe, test, expect } from 'bun:test';
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  isSupportedLocale,
  normalizeLocale,
  parseAcceptLanguage,
} from './index';

describe('locale constants', () => {
  test('supports en, de, fr with en default', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['en', 'de', 'fr']);
    expect(DEFAULT_LOCALE).toBe('en');
  });
});

describe('isSupportedLocale', () => {
  test('accepts supported, rejects everything else', () => {
    expect(isSupportedLocale('de')).toBe(true);
    expect(isSupportedLocale('it')).toBe(false);
    expect(isSupportedLocale('de-CH')).toBe(false); // base subtags only
    expect(isSupportedLocale(undefined)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });
});

describe('normalizeLocale', () => {
  test('strips region and lowercases', () => {
    expect(normalizeLocale('de-CH')).toBe('de');
    expect(normalizeLocale('FR')).toBe('fr');
    expect(normalizeLocale('en-US')).toBe('en');
  });

  test('falls back to default for unknown/empty', () => {
    expect(normalizeLocale('it')).toBe('en');
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
  });
});

describe('parseAcceptLanguage', () => {
  test('picks the highest-q supported language', () => {
    expect(parseAcceptLanguage('fr-CH,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });

  test('skips unsupported languages even at higher q', () => {
    expect(parseAcceptLanguage('it,de;q=0.5')).toBe('de');
  });

  test('falls back to default when nothing matches', () => {
    expect(parseAcceptLanguage('it,es;q=0.5')).toBe('en');
    expect(parseAcceptLanguage('')).toBe('en');
    expect(parseAcceptLanguage(null)).toBe('en');
  });
});
