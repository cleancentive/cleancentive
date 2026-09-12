import { describe, expect, test } from 'bun:test';

import { DEFAULT_SERIES_WEEKS, listWeekStarts, parseWeeksParam } from './weekly-series';

describe('listWeekStarts', () => {
  test('returns one key per requested week, oldest first', () => {
    const weeks = listWeekStarts(4, new Date('2026-09-12T10:00:00Z'));
    expect(weeks).toEqual(['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']);
  });

  test('every key is a Monday, matching date_trunc(week)', () => {
    for (const week of listWeekStarts(12, new Date('2026-09-12T10:00:00Z'))) {
      expect(new Date(`${week}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  test('a Monday belongs to the week it starts', () => {
    expect(listWeekStarts(1, new Date('2026-09-07T00:00:00Z'))).toEqual(['2026-09-07']);
  });

  test('a Sunday belongs to the week that started six days earlier', () => {
    expect(listWeekStarts(1, new Date('2026-09-13T23:59:59Z'))).toEqual(['2026-09-07']);
  });

  test('walks back across a year boundary', () => {
    expect(listWeekStarts(3, new Date('2027-01-06T12:00:00Z'))).toEqual([
      '2026-12-21',
      '2026-12-28',
      '2027-01-04',
    ]);
  });

  test('weeks = 1 returns only the current week', () => {
    expect(listWeekStarts(1, new Date('2026-09-12T10:00:00Z'))).toEqual(['2026-09-07']);
  });
});

describe('parseWeeksParam', () => {
  test('defaults when absent or unparseable', () => {
    expect(parseWeeksParam(undefined)).toBe(DEFAULT_SERIES_WEEKS);
    expect(parseWeeksParam('')).toBe(DEFAULT_SERIES_WEEKS);
    expect(parseWeeksParam('nonsense')).toBe(DEFAULT_SERIES_WEEKS);
  });

  test('defaults rather than accepting a non-positive window', () => {
    expect(parseWeeksParam('0')).toBe(DEFAULT_SERIES_WEEKS);
    expect(parseWeeksParam('-5')).toBe(DEFAULT_SERIES_WEEKS);
  });

  test('accepts a valid window and caps at a year', () => {
    expect(parseWeeksParam('4')).toBe(4);
    expect(parseWeeksParam('52')).toBe(52);
    expect(parseWeeksParam('500')).toBe(52);
  });
});
