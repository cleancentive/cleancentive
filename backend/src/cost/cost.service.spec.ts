import { describe, test, expect } from 'bun:test';
import { toChf, fallbackRates } from './providers/fx';
import { computeBackblazeCost } from './providers/backblaze';
import { computeResendCost } from './providers/resend';
import { unavailable, type FxRates } from './cost.types';

const fx: FxRates = { rates: { CHF: 1, EUR: 0.9451, USD: 0.8101 }, date: '2026-09-11', stale: false };

describe('toChf', () => {
  test('converts each vendor currency at its own rate', () => {
    expect(toChf(38.9, 'EUR', fx)).toBeCloseTo(38.9 * 0.9451, 6);
    expect(toChf(12.4, 'USD', fx)).toBeCloseTo(12.4 * 0.8101, 6);
    expect(toChf(10, 'CHF', fx)).toBe(10);
  });

  test('is case-insensitive about the currency code', () => {
    expect(toChf(10, 'eur', fx)).toBeCloseTo(9.451, 6);
  });

  test('an unknown currency converts to null rather than to itself', () => {
    expect(toChf(10, 'JPY', fx)).toBeNull();
  });

  test('an unavailable vendor stays unconverted', () => {
    expect(toChf(null, 'EUR', fx)).toBeNull();
    expect(toChf(10, null, fx)).toBeNull();
  });

  test('the fallback rates still convert, and say they are stale', () => {
    const fallback = fallbackRates();
    expect(fallback.stale).toBe(true);
    expect(toChf(100, 'EUR', fallback)).toBeGreaterThan(0);
  });
});

describe('unavailable', () => {
  test('carries the reason and nulls every figure, so nothing sums as zero', () => {
    const cost = unavailable('hetzner', new Error('HETZNER_API_TOKEN is not set'));
    expect(cost.status).toBe('unavailable');
    expect(cost.projectedMonth).toBeNull();
    expect(cost.monthToDate).toBeNull();
    expect(cost.error).toBe('HETZNER_API_TOKEN is not set');
  });
});

describe('computeBackblazeCost', () => {
  test('prices stored bytes at the published per-TB rate', () => {
    expect(computeBackblazeCost(1_000_000_000_000).projectedMonth).toBeCloseTo(6, 6);
    expect(computeBackblazeCost(250_000_000_000).projectedMonth).toBeCloseTo(1.5, 6);
  });

  test('an empty bucket costs nothing but still reports', () => {
    const cost = computeBackblazeCost(0);
    expect(cost.status).toBe('ok');
    expect(cost.projectedMonth).toBe(0);
  });

  test('says out loud that the wiki bucket is not included', () => {
    expect(computeBackblazeCost(1).note).toEqual({ key: 'backblaze' });
  });
});

describe('computeResendCost', () => {
  const free = { monthlyUsd: 0, includedEmails: 3000 };

  test('the free tier under its allowance costs nothing', () => {
    const cost = computeResendCost(400, free, 15, 30);
    expect(cost.projectedMonth).toBe(0);
    expect(cost.note).toEqual({ key: 'resend', params: { sent: 400, included: 3000 } });
  });

  test('projects the month from the send rate so far', () => {
    // 2000 in 10 days projects to 6000 over 30 — 3000 over the allowance.
    const cost = computeResendCost(2000, free, 10, 30);
    expect(cost.projectedMonth).toBeCloseTo(3000 * 0.0009, 6);
  });

  test('month-to-date reflects what has actually been sent, not the projection', () => {
    const cost = computeResendCost(2000, free, 10, 30);
    expect(cost.monthToDate).toBe(0);
  });

  test('a paid plan charges its fee even with no email sent', () => {
    const cost = computeResendCost(0, { monthlyUsd: 20, includedEmails: 50_000 }, 5, 30);
    expect(cost.projectedMonth).toBe(20);
  });

  test('the first day of the month does not divide by zero', () => {
    const cost = computeResendCost(100, free, 0, 30);
    expect(Number.isFinite(cost.projectedMonth ?? NaN)).toBe(true);
  });
});
