import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PlantNetIdentifier } from './plantnet';
import { lookupInvasive } from '../infoflora';

const originalFetch = globalThis.fetch;

function mockFetch(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = (async () => ({
    ok: response.ok,
    status: response.status ?? 200,
    text: async () => JSON.stringify(response.body),
    json: async () => response.body,
  })) as typeof fetch;
}

describe('PlantNetIdentifier', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns top species when score >= min confidence', async () => {
    mockFetch({
      ok: true,
      body: {
        results: [
          { score: 0.92, species: { scientificNameWithoutAuthor: 'Reynoutria japonica', commonNames: ['Japanese knotweed'] } },
          { score: 0.05, species: { scientificNameWithoutAuthor: 'Other species', commonNames: ['Other'] } },
        ],
      },
    });
    const id = new PlantNetIdentifier('key', 'https://example.test/v2', 'weurope', 0.6);
    const result = await id.identify(new Uint8Array([0xff, 0xd8]), 'image/jpeg');
    expect(result.scientificName).toBe('Reynoutria japonica');
    expect(result.commonName).toBe('Japanese knotweed');
    expect(result.confidence).toBe(0.92);
    expect(result.source).toBe('plantnet');
  });

  test('returns null scientificName when top score is below threshold', async () => {
    mockFetch({
      ok: true,
      body: { results: [{ score: 0.3, species: { scientificNameWithoutAuthor: 'Maybe a plant' } }] },
    });
    const id = new PlantNetIdentifier('key', 'https://example.test/v2', 'weurope', 0.6);
    const result = await id.identify(new Uint8Array([0xff]), 'image/jpeg');
    expect(result.scientificName).toBeNull();
    expect(result.confidence).toBe(0.3);
  });

  test('throws on non-2xx response', async () => {
    mockFetch({ ok: false, status: 429, body: { error: 'rate limited' } });
    const id = new PlantNetIdentifier('key', 'https://example.test/v2', 'weurope', 0.6);
    await expect(id.identify(new Uint8Array([0xff]), 'image/jpeg')).rejects.toThrow(/429/);
  });

  test('InfoFlora flags an identified Japanese knotweed as black-list', () => {
    const invasive = lookupInvasive('Reynoutria japonica');
    expect(invasive?.list).toBe('infoflora_black');
  });
});
