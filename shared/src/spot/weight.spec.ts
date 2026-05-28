import { describe, test, expect } from 'bun:test';
import { clampWeightGrams, MIN_WEIGHT_GRAMS } from './weight';

describe('clampWeightGrams', () => {
  test('null and undefined pass through as null', () => {
    expect(clampWeightGrams(null)).toBeNull();
    expect(clampWeightGrams(undefined)).toBeNull();
  });

  test('NaN is treated as unknown (null)', () => {
    expect(clampWeightGrams(NaN)).toBeNull();
  });

  test('values below 1g are clamped up to the floor', () => {
    expect(clampWeightGrams(0)).toBe(MIN_WEIGHT_GRAMS);
    expect(clampWeightGrams(0.3)).toBe(MIN_WEIGHT_GRAMS);
    expect(clampWeightGrams(0.999)).toBe(MIN_WEIGHT_GRAMS);
  });

  test('negative values are clamped up to the floor', () => {
    expect(clampWeightGrams(-5)).toBe(MIN_WEIGHT_GRAMS);
  });

  test('values at or above 1g pass through unchanged', () => {
    expect(clampWeightGrams(1)).toBe(1);
    expect(clampWeightGrams(100)).toBe(100);
    expect(clampWeightGrams(5000)).toBe(5000);
  });

  test('non-number types (would-be runtime input) are treated as unknown', () => {
    expect(clampWeightGrams('5' as unknown as number)).toBeNull();
  });
});
