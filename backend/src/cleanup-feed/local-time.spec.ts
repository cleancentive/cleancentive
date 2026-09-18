import { describe, expect, test } from 'bun:test';

import { zonedToUtc, zonedDayKey } from './local-time';

const ZURICH = 'Europe/Zurich';

describe('zonedToUtc', () => {
  test('summer time is UTC+2', () => {
    expect(zonedToUtc(2026, 9, 18, 9, 0, ZURICH).toISOString()).toBe('2026-09-18T07:00:00.000Z');
  });

  test('winter time is UTC+1', () => {
    expect(zonedToUtc(2026, 12, 5, 9, 0, ZURICH).toISOString()).toBe('2026-12-05T08:00:00.000Z');
  });

  test('the day the clocks go forward', () => {
    // 02:00 -> 03:00 on 2026-03-29; 01:30 local is still winter time.
    expect(zonedToUtc(2026, 3, 29, 1, 30, ZURICH).toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(zonedToUtc(2026, 3, 29, 9, 0, ZURICH).toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });

  test('the day the clocks go back', () => {
    expect(zonedToUtc(2026, 10, 25, 9, 0, ZURICH).toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  test('a time inside the spring-forward gap resolves to a real instant', () => {
    // 02:30 does not exist locally; it must still produce a usable instant
    // rather than NaN, and stay within the hour it was meant for.
    const gap = zonedToUtc(2026, 3, 29, 2, 30, ZURICH);
    expect(Number.isNaN(gap.getTime())).toBe(false);
    expect(gap.toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('zonedDayKey', () => {
  test('reports the local day, not the UTC one', () => {
    // 23:30 UTC is already the next day in Zurich.
    expect(zonedDayKey(new Date('2026-06-14T23:30:00.000Z'), ZURICH)).toBe('2026-06-15');
    expect(zonedDayKey(new Date('2026-06-15T05:00:00.000Z'), ZURICH)).toBe('2026-06-15');
  });
});
