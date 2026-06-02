// Deterministic PRNG utilities for synthetic data generation.
//
// Nothing here reads Math.random or the wall clock — every value is a pure
// function of an explicit seed. Regenerating a bundle from the same LayerSpec
// therefore produces byte-identical ids/values, which is what makes
// `db-import --mode merge` idempotent (re-applying upserts in place).

import type { GeoBox } from './spec';

// Hash a string into a 32-bit seed (used to derive named sub-streams).
export function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next01: () => number;

  constructor(seed: number) {
    this.next01 = mulberry32(seed >>> 0);
  }

  // Derive an independent sub-stream from a base seed and a stable name, so
  // unrelated generation (e.g. spot #500) does not shift when counts change.
  static stream(baseSeed: number, name: string): Rng {
    return new Rng((baseSeed ^ xmur3(name)) >>> 0);
  }

  float(min = 0, max = 1): number {
    return min + (max - min) * this.next01();
  }

  // Inclusive integer in [min, max].
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  bool(p = 0.5): boolean {
    return this.next01() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next01() * arr.length)];
  }

  // Weighted pick; weights need not sum to 1.
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.next01() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  // Approximate normal via the central-limit trick (sum of 12 uniforms − 6),
  // clamped to [min, max].
  gaussian(mean: number, stddev: number, min = -Infinity, max = Infinity): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.next01();
    return Math.max(min, Math.min(max, mean + (s - 6) * stddev));
  }

  // Fisher–Yates shuffle (returns a new array).
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next01() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Epoch-ms within [startMs, endMs]. biasPow > 1 weights results toward the
  // end of the window (models an adoption ramp); 1 is uniform.
  dateInWindow(startMs: number, endMs: number, biasPow = 1): number {
    const f = Math.pow(this.next01(), 1 / biasPow);
    return Math.round(startMs + (endMs - startMs) * f);
  }

  geoInBox(box: GeoBox): { lat: number; lng: number } {
    return {
      lat: round6(this.float(box.minLat, box.maxLat)),
      lng: round6(this.float(box.minLng, box.maxLng)),
    };
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
