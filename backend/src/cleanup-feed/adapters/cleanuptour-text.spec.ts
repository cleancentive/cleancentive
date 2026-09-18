import { describe, expect, test } from 'bun:test';

import { parseDayMonth, monthFromName, inferYear, extractTimes, DEFAULT_TIMES } from './cleanuptour-text';

describe('parseDayMonth', () => {
  test('reads the German and French heading forms', () => {
    expect(parseDayMonth('18 September :')).toEqual({ day: 18, month: 9 });
    expect(parseDayMonth('12 avril')).toEqual({ day: 12, month: 4 });
    expect(parseDayMonth('1. Oktober')).toEqual({ day: 1, month: 10 });
  });

  test('accents do not matter', () => {
    expect(monthFromName('Février')).toBe(2);
    expect(monthFromName('février')).toBe(2);
    expect(monthFromName('März')).toBe(3);
    expect(monthFromName('aout')).toBe(8);
  });

  test('returns null when there is no date to read', () => {
    expect(parseDayMonth('Zermatt')).toBeNull();
    expect(parseDayMonth('18 Blumonth')).toBeNull();
    expect(parseDayMonth('')).toBeNull();
  });
});

describe('inferYear', () => {
  const published = new Date('2025-03-03T00:00:00Z');
  const modified = new Date('2026-08-13T00:00:00Z');

  test('a date spelled out in the body wins', () => {
    const year = inferYear({
      day: 18,
      month: 9,
      bodyText: 'Le vendredi 18.09.2026, à l’occasion du Clean-Up-Day national…',
      seasonYear: null,
      modifiedAt: modified,
      publishedAt: published,
    });
    expect(year).toBe(2026);
  });

  test('a registration deadline in the same prose is not mistaken for the date', () => {
    // The German Zermatt page says "18. September" for the event and
    // "4. September 2026" for the sign-up deadline.
    const year = inferYear({
      day: 18,
      month: 9,
      bodyText: 'Bitte melde dich bis Freitag, 4. September 2026, per Anmeldeformular an.',
      seasonYear: 2026,
      modifiedAt: modified,
      publishedAt: published,
    });
    expect(year).toBe(2026);
  });

  test('falls back to the season year from the listing', () => {
    expect(
      inferYear({ day: 17, month: 10, bodyText: 'no date here', seasonYear: 2026, modifiedAt: modified, publishedAt: published }),
    ).toBe(2026);
  });

  test('falls back to the year the page was published', () => {
    expect(
      inferYear({ day: 10, month: 5, bodyText: '', seasonYear: null, modifiedAt: null, publishedAt: new Date('2026-02-01T00:00:00Z') }),
    ).toBe(2026);
  });

  test('rolls forward when the page was re-used for the next season', () => {
    // Season year 2026 but the post was last edited in Nov 2026 for a spring
    // 2027 edition: April 2026 is long past, so it means April 2027.
    expect(
      inferYear({
        day: 12,
        month: 4,
        bodyText: '',
        seasonYear: 2026,
        modifiedAt: new Date('2026-11-20T00:00:00Z'),
        publishedAt: published,
      }),
    ).toBe(2027);
  });

  test('gives up when nothing says which year', () => {
    expect(inferYear({ day: 12, month: 4, bodyText: '', seasonYear: null, modifiedAt: null, publishedAt: null })).toBeNull();
  });
});

describe('extractTimes', () => {
  test('reads the first and last time of a German programme', () => {
    const body = [
      '08h00 : Einfinden aller Helfer',
      '08.00 - 11.30 Uhr (Gruppen im Dorf) oder bis 15.30 Uhr (Gruppen oberhalb)',
      '11h30 : Clean-Up-Countdown',
      '15h30 : Tagesschluss',
    ].join('\n');
    expect(extractTimes(body)).toEqual({ startHour: 8, startMinute: 0, endHour: 15, endMinute: 30 });
  });

  test('a written date is not a time', () => {
    expect(extractTimes('Le vendredi 18.09.2026, rendez-vous.')).toEqual(DEFAULT_TIMES);
  });

  test('a phone number is not a time', () => {
    expect(extractTimes('telefonisch unter +41 27 966 22 93 anmelden')).toEqual(DEFAULT_TIMES);
  });

  test('no times at all falls back to the usual cleanup day', () => {
    expect(extractTimes('Rejoins-nous et aide-nous à débarrasser la montagne.')).toEqual(DEFAULT_TIMES);
  });

  test('a single stated time gets a six-hour day', () => {
    expect(extractTimes('Treffpunkt 09h00 beim Kirchplatz')).toEqual({
      startHour: 9,
      startMinute: 0,
      endHour: 15,
      endMinute: 0,
    });
  });
});
