import { describe, test, expect } from 'bun:test';
import { normalizeAnnotation } from './invoice-ingest.service';

describe('normalizeAnnotation', () => {
  test('reads a well-formed Hetzner annotation', () => {
    const parsed = normalizeAnnotation({
      vendor: 'Hetzner',
      invoice_date: '2026-09-01',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      currency: 'eur',
      amount_gross: 38.9,
    });

    expect(parsed).toEqual({
      vendor: 'hetzner',
      invoiceDate: '2026-09-01',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      currency: 'EUR',
      amountGross: 38.9,
    });
  });

  test('accepts the annotation as a JSON string, which is how OCR returns it', () => {
    const parsed = normalizeAnnotation(
      JSON.stringify({ vendor: 'mistral', invoice_date: '2026-09-01', currency: 'USD', amount_gross: 12.4 }),
    );
    expect(parsed?.vendor).toBe('mistral');
    expect(parsed?.amountGross).toBe(12.4);
  });

  test('a vendor we do not recognise is filed as other, not dropped', () => {
    const parsed = normalizeAnnotation({
      vendor: 'Some Registrar GmbH',
      invoice_date: '2026-09-01',
      currency: 'CHF',
      amount_gross: 15,
    });
    expect(parsed?.vendor).toBe('other');
  });

  test('a missing or zero total is rejected rather than stored as free', () => {
    expect(normalizeAnnotation({ vendor: 'hetzner', currency: 'EUR' })).toBeNull();
    expect(normalizeAnnotation({ vendor: 'hetzner', currency: 'EUR', amount_gross: 0 })).toBeNull();
    expect(normalizeAnnotation({ vendor: 'hetzner', currency: 'EUR', amount_gross: 'lots' })).toBeNull();
  });

  test('a nonsense currency is rejected — a number without one cannot be converted', () => {
    expect(normalizeAnnotation({ vendor: 'hetzner', currency: 'Euro', amount_gross: 38.9 })).toBeNull();
    expect(normalizeAnnotation({ vendor: 'hetzner', amount_gross: 38.9 })).toBeNull();
  });

  test('a malformed date is dropped without losing the amount', () => {
    const parsed = normalizeAnnotation({
      vendor: 'resend',
      invoice_date: '1 September 2026',
      currency: 'USD',
      amount_gross: 20,
    });
    expect(parsed?.invoiceDate).toBeNull();
    expect(parsed?.amountGross).toBe(20);
  });

  test('unparseable output does not throw', () => {
    expect(normalizeAnnotation('not json at all')).toBeNull();
    expect(normalizeAnnotation(null)).toBeNull();
    expect(normalizeAnnotation(undefined)).toBeNull();
  });
});
