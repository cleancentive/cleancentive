import { getJson } from '../http';
import type { FxRates } from '../cost.types';

const FRANKFURTER = 'https://api.frankfurter.dev/v1';

/**
 * Rates last resorted to when Frankfurter is unreachable and Redis is cold.
 *
 * Being a few percent out on a converted total is a far better failure than a
 * cost page that will not render, so these exist purely so the page always has
 * a number. Anything served from here is flagged stale in the response.
 */
const FALLBACK_TO_CHF: Record<string, number> = { CHF: 1, EUR: 0.945, USD: 0.815 };

interface FrankfurterResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

/**
 * How much one unit of each currency is worth in CHF.
 *
 * Frankfurter quotes against a single base, so USD→CHF and EUR→CHF need two
 * calls — or one call per base. We ask for CHF against each base we actually
 * bill in, which is two requests and no cross-rate arithmetic of our own.
 */
export async function fetchChfRates(): Promise<FxRates> {
  const [eur, usd] = await Promise.all([
    getJson<FrankfurterResponse>(`${FRANKFURTER}/latest?base=EUR&symbols=CHF`),
    getJson<FrankfurterResponse>(`${FRANKFURTER}/latest?base=USD&symbols=CHF`),
  ]);

  return {
    rates: { CHF: 1, EUR: eur.rates.CHF, USD: usd.rates.CHF },
    date: eur.date,
    stale: false,
  };
}

/** The CHF rate for one currency on a given date, for pricing a past invoice. */
export async function fetchChfRateOn(currency: string, date: string): Promise<number> {
  if (currency.toUpperCase() === 'CHF') return 1;

  // Frankfurter answers a weekend or holiday with the preceding business day,
  // which is the right rate for an invoice dated then.
  const response = await getJson<FrankfurterResponse>(
    `${FRANKFURTER}/${date}?base=${encodeURIComponent(currency.toUpperCase())}&symbols=CHF`,
  );

  const rate = response.rates?.CHF;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error(`Frankfurter returned no CHF rate for ${currency} on ${date}`);
  }
  return rate;
}

export function fallbackRates(): FxRates {
  return { rates: { ...FALLBACK_TO_CHF }, date: 'unknown', stale: true };
}

export function toChf(amount: number | null, currency: string | null, fx: FxRates): number | null {
  if (amount === null || !currency) return null;
  const rate = fx.rates[currency.toUpperCase()];
  if (typeof rate !== 'number') return null;
  return amount * rate;
}
