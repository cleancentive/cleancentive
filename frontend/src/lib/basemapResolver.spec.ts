import { describe, expect, test } from 'vitest'

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

describe('resolveBasemapTheme', () => {
  test('resolves standard to one global layer', () => {
    expectTheme('standard', 8.54, 47.37, ['carto-voyager'])
    expectTheme('standard', -74.0, 40.71, ['carto-voyager'])
  })

  test('resolves dark to one global layer', () => {
    expectTheme('dark', 8.54, 47.37, ['carto-dark'])
    expectTheme('dark', 139.69, 35.68, ['carto-dark'])
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
