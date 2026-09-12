import { describe, test, expect } from 'bun:test';
import { priceUsd, pagePriceUsd, TOKEN_PRICES } from './model-prices';

describe('priceUsd', () => {
  test('prices input and output tokens at their separate rates', () => {
    // mistral-medium-latest: $1.5/M in, $7.5/M out
    expect(priceUsd('mistral-medium-latest', 1_000_000, 0)).toBeCloseTo(1.5, 10);
    expect(priceUsd('mistral-medium-latest', 0, 1_000_000)).toBeCloseTo(7.5, 10);
    expect(priceUsd('mistral-medium-latest', 1_000_000, 1_000_000)).toBeCloseTo(9, 10);
  });

  test('a realistic detection call costs a fraction of a cent', () => {
    const cost = priceUsd('mistral-medium-latest', 1800, 250);
    expect(cost).toBeCloseTo(0.004575, 10);
  });

  test('a dated release prices the same as its -latest alias', () => {
    expect(priceUsd('mistral-medium-2508', 1000, 100)).toBe(
      priceUsd('mistral-medium-latest', 1000, 100),
    );
  });

  test('an unknown model is unpriced rather than free', () => {
    expect(priceUsd('some-model-we-never-heard-of', 1_000_000, 1_000_000)).toBeNull();
  });

  test('a page-priced model is not token-priced', () => {
    expect(priceUsd('mistral-ocr-latest', 1_000_000, 0)).toBeNull();
  });

  test('zero tokens cost zero, not null, for a known model', () => {
    expect(priceUsd('mistral-small-latest', 0, 0)).toBe(0);
  });
});

describe('pagePriceUsd', () => {
  test('prices per thousand pages', () => {
    expect(pagePriceUsd('mistral-ocr-latest', 1000)).toBeCloseTo(5, 10);
    expect(pagePriceUsd('mistral-ocr-latest', 1)).toBeCloseTo(0.005, 10);
  });

  test('an unknown model is unpriced', () => {
    expect(pagePriceUsd('mistral-medium-latest', 10)).toBeNull();
  });
});

describe('TOKEN_PRICES', () => {
  test('output is never cheaper than input, which would signal a transcription slip', () => {
    for (const [model, price] of Object.entries(TOKEN_PRICES)) {
      expect(price.outputPerMTokens >= price.inputPerMTokens).toBe(true);
      expect(model.endsWith('-latest')).toBe(true);
    }
  });
});
