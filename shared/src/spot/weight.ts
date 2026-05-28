export const MIN_WEIGHT_GRAMS = 1;

export function clampWeightGrams(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value < MIN_WEIGHT_GRAMS ? MIN_WEIGHT_GRAMS : value;
}
