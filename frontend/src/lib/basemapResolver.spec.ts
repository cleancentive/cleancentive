import { afterEach, describe, expect, test } from 'vitest'

import {
  mapLegacyBasemapIdToTheme,
  resolveBasemapTheme,
  type BasemapTheme,
} from '../config/basemaps'

function expectTheme(
  theme: BasemapTheme,
  lon: number,
  lat: number,
  sourceIds: string[],
  zoom = 8,
  span = 0.5,
) {
  const resolved = resolveBasemapTheme(theme, {
    center: { lon, lat },
    zoom,
    bounds: {
      west: lon - span,
      south: lat - span,
      east: lon + span,
      north: lat + span,
    },
  })
  expect(resolved.layers.map((layer) => layer.source.id)).toEqual(sourceIds)
}

// The Stadia key reaches the app through window.__CLEANCENTIVE_CONFIG__, injected
// at container start. Unset here, the resolver must fall back to keyless tiles.
function setStadiaKey(key: string | undefined) {
  const win = globalThis as { window?: Window }
  if (!win.window) win.window = {} as Window
  win.window.__CLEANCENTIVE_CONFIG__ = key ? { stadiaApiKey: key } : {}
}

afterEach(() => {
  setStadiaKey(undefined)
})

describe('resolveBasemapTheme', () => {
  test('resolves standard to one keyed global layer', () => {
    setStadiaKey('test-key')
    expectTheme('standard', 8.54, 47.37, ['stadia-alidade-bright'])
    expectTheme('standard', -74.0, 40.71, ['stadia-alidade-bright'])
  })

  test('resolves dark to one keyed global layer', () => {
    setStadiaKey('test-key')
    expectTheme('dark', 8.54, 47.37, ['stadia-alidade-smooth-dark'])
    expectTheme('dark', 139.69, 35.68, ['stadia-alidade-smooth-dark'])
  })

  test('passes the configured key to the tile URLs', () => {
    setStadiaKey('test-key')
    const resolved = resolveBasemapTheme('standard', { center: { lon: 8.54, lat: 47.37 } })
    expect(resolved.layers[0].source.tiles[0]).toContain('api_key=test-key')
  })

  // Regression: without a key the CARTO basemaps these replaced served tiles
  // watermarked "API KEY REQUIRED". The fallback must be keyless.
  test('falls back to keyless layers when no key is configured', () => {
    expectTheme('standard', 8.54, 47.37, ['esri-world-street'])
    expectTheme('dark', 8.54, 47.37, ['esri-dark-gray-base', 'esri-dark-gray-labels'])
  })

  test('keyless fallback tiles carry no api_key', () => {
    const resolved = resolveBasemapTheme('dark', { center: { lon: 8.54, lat: 47.37 } })
    for (const layer of resolved.layers) {
      expect(layer.source.tiles[0]).not.toContain('api_key')
    }
  })

  test('keeps fallback active when zoomed out in Switzerland', () => {
    expectTheme('aerial', 8.54, 47.37, ['esri-world-imagery'], 6, 2)
  })

  test('uses local aerial only when zoomed in and bounds are fully inside Switzerland', () => {
    expectTheme('aerial', 8.54, 47.37, ['swisstopo-swissimage'], 10, 0.2)
  })

  test('resolves aerial to global fallback outside Switzerland', () => {
    expectTheme('aerial', -0.12, 51.5, ['esri-world-imagery'])
  })

  test('keeps topo fallback active when bounds extend outside Switzerland', () => {
    expectTheme('topo', 7.44, 46.95, ['opentopomap'], 10, 2)
  })

  test('uses local topo only when zoomed in and bounds are fully inside Switzerland', () => {
    expectTheme('topo', 7.44, 46.95, ['swisstopo-pixelkarte-farbe'], 10, 0.2)
  })

  test('resolves topo to global fallback outside Switzerland', () => {
    expectTheme('topo', 2.35, 48.85, ['opentopomap'])
  })
})

describe('mapLegacyBasemapIdToTheme', () => {
  test('maps known provider IDs to themes', () => {
    expect(mapLegacyBasemapIdToTheme('osm')).toBe('standard')
    expect(mapLegacyBasemapIdToTheme('carto-voyager')).toBe('standard')
    expect(mapLegacyBasemapIdToTheme('swisstopo-swissimage')).toBe('aerial')
    expect(mapLegacyBasemapIdToTheme('esri-world-imagery')).toBe('aerial')
    expect(mapLegacyBasemapIdToTheme('swisstopo-pixelkarte-farbe')).toBe('topo')
    expect(mapLegacyBasemapIdToTheme('opentopomap')).toBe('topo')
    expect(mapLegacyBasemapIdToTheme('carto-dark')).toBe('dark')
  })

  test('falls back to standard for unknown IDs', () => {
    expect(mapLegacyBasemapIdToTheme('unknown-id')).toBe('standard')
  })
})
