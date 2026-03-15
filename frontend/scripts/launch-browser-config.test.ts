import { describe, expect, test } from 'vitest';

import {
  MAILPIT_URL,
  MINIO_URL,
  POSTGRES_BROWSER_URL,
  SWAGGER_URL,
  buildBrowserToolTargets,
  randomGeoInRadius,
} from './launch-browser-config';

describe('buildBrowserToolTargets', () => {
  test('includes the shared local tool tabs in the expected order', () => {
    const targets = buildBrowserToolTargets({});

    expect(targets.map((target) => target.url)).toEqual([
      MINIO_URL,
      POSTGRES_BROWSER_URL,
      SWAGGER_URL,
      MAILPIT_URL,
      'http://localhost:5173',
    ]);
  });

  test('uses BROWSER_URL when provided', () => {
    const targets = buildBrowserToolTargets({ BROWSER_URL: 'http://localhost:4173' });

    expect(targets.at(-1)).toEqual({ name: 'App', url: 'http://localhost:4173', login: 'none' });
  });
});

describe('randomGeoInRadius', () => {
  test('returns a geolocation-like object', () => {
    const location = randomGeoInRadius(47.5596, 7.5886, 5);

    expect(location.latitude).toEqual(expect.any(Number));
    expect(location.longitude).toEqual(expect.any(Number));
    expect(location.accuracy).toBeGreaterThanOrEqual(10);
  });
});
