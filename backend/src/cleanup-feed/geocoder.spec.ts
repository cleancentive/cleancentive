import { describe, expect, test } from 'bun:test';

import { Geocoder } from './geocoder';
import { RequestPacer } from './fetch-page';

/** Pacing is verified in fetch-page.spec; here it would only add real seconds. */
const noPacing = () => new RequestPacer(0, async () => {});

/** Redis stub: the cache is a Map, and a failing one must not break geocoding. */
function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
  } as any;
}

function makeFetch(responses: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const host = new URL(url).host;
    const body = responses[host];
    if (body === undefined) {
      return new Response('', { status: 500 });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const GEO_ADMIN = 'api3.geo.admin.ch';
const NOMINATIM = 'nominatim.openstreetmap.org';

describe('Geocoder', () => {
  test('uses the Swiss service when it knows the address', async () => {
    const { impl, calls } = makeFetch({
      [GEO_ADMIN]: { results: [{ attrs: { lat: 46.0227, lon: 7.7522 } }] },
    });
    const geocoder = new Geocoder(impl, makeRedis(), noPacing());

    expect(await geocoder.locate('Wiestistrasse, 44, Zermatt, Wallis, 3920, Suisse')).toEqual({
      latitude: 46.0227,
      longitude: 7.7522,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(GEO_ADMIN);
  });

  test('falls back to Nominatim for what the Swiss service misses', async () => {
    // "Col de la Furka" is the real case: geo.admin returns unrelated places.
    const { impl, calls } = makeFetch({
      [GEO_ADMIN]: { results: [] },
      [NOMINATIM]: [{ lat: '46.5725', lon: '8.4152' }],
    });
    const geocoder = new Geocoder(impl, makeRedis(), noPacing());

    expect(await geocoder.locate('Col de la Furka')).toEqual({ latitude: 46.5725, longitude: 8.4152 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain(NOMINATIM);
  });

  test('a cached hit costs no request', async () => {
    const redis = makeRedis({
      'cleanup-feed:geocode:zermatt': JSON.stringify({ latitude: 46.02, longitude: 7.75 }),
    });
    const { impl, calls } = makeFetch({});
    const geocoder = new Geocoder(impl, redis, noPacing());

    expect(await geocoder.locate('Zermatt')).toEqual({ latitude: 46.02, longitude: 7.75 });
    expect(calls).toHaveLength(0);
  });

  test('an address nobody knows is remembered as a miss', async () => {
    const redis = makeRedis();
    const { impl } = makeFetch({ [GEO_ADMIN]: { results: [] }, [NOMINATIM]: [] });
    const geocoder = new Geocoder(impl, redis, noPacing());

    expect(await geocoder.locate('somewhere unnameable')).toBeNull();
    expect(redis.store.get('cleanup-feed:geocode:somewhere unnameable')).toBe('');

    // And the miss is served from cache rather than asked again.
    const second = new Geocoder(makeFetch({}).impl, redis, noPacing());
    expect(await second.locate('somewhere unnameable')).toBeNull();
  });

  test('nonsense coordinates are rejected rather than stored', async () => {
    const { impl } = makeFetch({
      [GEO_ADMIN]: { results: [{ attrs: { lat: 999, lon: 7.75 } }] },
      [NOMINATIM]: [],
    });
    const geocoder = new Geocoder(impl, makeRedis(), noPacing());
    expect(await geocoder.locate('broken')).toBeNull();
  });

  test('a geocoder that is down yields null instead of throwing', async () => {
    const { impl } = makeFetch({});   // every host 500s
    const geocoder = new Geocoder(impl, makeRedis(), noPacing());
    expect(await geocoder.locate('Zermatt')).toBeNull();
  });
});
