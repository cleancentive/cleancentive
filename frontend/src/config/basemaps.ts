import type {
  LayerSpecification,
  RasterSourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'

export type BasemapTheme = 'standard' | 'aerial' | 'topo' | 'dark'

export interface BasemapSource {
  id: string
  label: string
  tiles: string[]
  attribution: string
  tileSize?: number
  maxZoom?: number
}

export interface BasemapLayerChoice {
  source: BasemapSource
}

export interface ResolvedBasemap {
  theme: BasemapTheme
  layers: BasemapLayerChoice[]
}

export interface BasemapPoint {
  lon: number
  lat: number
}

export interface BasemapBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface BasemapResolveContext {
  center: BasemapPoint
  bounds?: BasemapBounds
  zoom?: number
}

const ATTR_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const ATTR_SWISSTOPO = '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>'
const ATTR_OPENTOPO =
  ATTR_OSM +
  ' | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
const ATTR_ESRI = 'Tiles &copy; Esri'
const ATTR_STADIA =
  '&copy; <a href="https://www.stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> ' +
  ATTR_OSM

function stadia(variant: string, ext: 'png' | 'jpg', key: string): string[] {
  return [`https://tiles.stadiamaps.com/tiles/${variant}/{z}/{x}/{y}.${ext}?api_key=${key}`]
}

function esriCanvas(service: string): string[] {
  return [
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${service}/MapServer/tile/{z}/{y}/{x}`,
  ]
}

function swisstopo(layer: string, ext: 'jpeg' | 'png'): string[] {
  return [
    `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.${ext}`,
  ]
}

// Injected at container start into window.__CLEANCENTIVE_CONFIG__ by
// frontend/docker-entrypoint.sh (config.js loads before the bundle), with a
// VITE_ override for dev. Read on every call rather than cached at module load:
// tests swap the stub between cases.
function stadiaApiKey(): string {
  const fromConfig = typeof window !== 'undefined'
    ? window.__CLEANCENTIVE_CONFIG__?.stadiaApiKey
    : undefined
  return fromConfig || import.meta.env.VITE_STADIA_API_KEY || ''
}

export const DEFAULT_BASEMAP_THEME: BasemapTheme = 'standard'

export const BASEMAP_THEMES: ReadonlyArray<{ id: BasemapTheme; label: string }> = [
  { id: 'standard', label: 'Standard' },
  { id: 'aerial', label: 'Aerial' },
  { id: 'topo', label: 'Topo' },
  { id: 'dark', label: 'Dark' },
]

const SOURCES = {
  // Keyless fallbacks for standard/dark. The street map carries its own labels;
  // the dark canvas needs a separate transparent label overlay and serves a
  // placeholder tile above zoom 16.
  standardFallback: {
    id: 'esri-world-street',
    label: 'Standard',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: ATTR_ESRI,
    maxZoom: 19,
  } satisfies BasemapSource,
  darkFallbackBase: {
    id: 'esri-dark-gray-base',
    label: 'Dark',
    tiles: esriCanvas('World_Dark_Gray_Base'),
    attribution: ATTR_ESRI,
    maxZoom: 16,
  } satisfies BasemapSource,
  darkFallbackLabels: {
    id: 'esri-dark-gray-labels',
    label: 'Dark labels',
    tiles: esriCanvas('World_Dark_Gray_Reference'),
    attribution: ATTR_ESRI,
    maxZoom: 16,
  } satisfies BasemapSource,
  aerialGlobal: {
    id: 'esri-world-imagery',
    label: 'Aerial',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: ATTR_ESRI,
    maxZoom: 19,
  } satisfies BasemapSource,
  aerialSwiss: {
    id: 'swisstopo-swissimage',
    label: 'Aerial CH',
    tiles: swisstopo('ch.swisstopo.swissimage', 'jpeg'),
    attribution: ATTR_SWISSTOPO,
    maxZoom: 19,
  } satisfies BasemapSource,
  topoGlobal: {
    id: 'opentopomap',
    label: 'Topo',
    tiles: ['a', 'b', 'c'].map(
      (s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`,
    ),
    attribution: ATTR_OPENTOPO,
    maxZoom: 17,
  } satisfies BasemapSource,
  topoSwiss: {
    id: 'swisstopo-pixelkarte-farbe',
    label: 'Topo CH',
    tiles: swisstopo('ch.swisstopo.pixelkarte-farbe', 'jpeg'),
    attribution: ATTR_SWISSTOPO,
    maxZoom: 19,
  } satisfies BasemapSource,
}

function stadiaSource(id: string, label: string, variant: string, key: string): BasemapSource {
  return {
    id,
    label,
    tiles: stadia(variant, 'png', key),
    attribution: ATTR_STADIA,
    maxZoom: 20,
  }
}

function standardLayers(): BasemapLayerChoice[] {
  const key = stadiaApiKey()
  if (key) {
    return [{ source: stadiaSource('stadia-alidade-bright', 'Standard', 'alidade_bright', key) }]
  }
  return [{ source: SOURCES.standardFallback }]
}

function darkLayers(): BasemapLayerChoice[] {
  const key = stadiaApiKey()
  if (key) {
    return [{
      source: stadiaSource('stadia-alidade-smooth-dark', 'Dark', 'alidade_smooth_dark', key),
    }]
  }
  return [
    { source: SOURCES.darkFallbackBase },
    { source: SOURCES.darkFallbackLabels },
  ]
}

const SWISS_BOUNDS = {
  minLon: 5.95,
  maxLon: 10.55,
  minLat: 45.75,
  maxLat: 47.9,
}

function boundsAreFullyInSwitzerland(bounds?: BasemapBounds): boolean {
  if (!bounds) return false
  return bounds.west >= SWISS_BOUNDS.minLon
    && bounds.east <= SWISS_BOUNDS.maxLon
    && bounds.south >= SWISS_BOUNDS.minLat
    && bounds.north <= SWISS_BOUNDS.maxLat
}

function shouldUseSwissOnly(context?: BasemapResolveContext): boolean {
  if (!context) return false
  const zoom = context.zoom ?? 0
  if (zoom < 9) return false
  return boundsAreFullyInSwitzerland(context.bounds)
}

export function resolveBasemapTheme(theme: BasemapTheme, context?: BasemapResolveContext): ResolvedBasemap {
  if (theme === 'standard') {
    return { theme, layers: standardLayers() }
  }
  if (theme === 'dark') {
    return { theme, layers: darkLayers() }
  }
  if (theme === 'aerial') {
    if (shouldUseSwissOnly(context)) {
      return { theme, layers: [{ source: SOURCES.aerialSwiss }] }
    }
    return {
      theme,
      layers: [{ source: SOURCES.aerialGlobal }],
    }
  }
  if (shouldUseSwissOnly(context)) {
    return { theme, layers: [{ source: SOURCES.topoSwiss }] }
  }
  return {
    theme,
    layers: [{ source: SOURCES.topoGlobal }],
  }
}

function toSourceSpec(source: BasemapSource): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: source.tiles,
    tileSize: source.tileSize ?? 256,
    attribution: source.attribution,
    ...(source.maxZoom ? { maxzoom: source.maxZoom } : {}),
  }
}

/** Bare MapLibre style carrying just the basemap layers of a resolved theme. */
export function buildBasemapStyle(resolved: ResolvedBasemap): StyleSpecification {
  const sources: StyleSpecification['sources'] = {}
  const layers: LayerSpecification[] = []

  resolved.layers.forEach(({ source }, index) => {
    const sourceId = `basemap-${index}`
    sources[sourceId] = toSourceSpec(source)
    layers.push({ id: sourceId, type: 'raster', source: sourceId })
  })

  return {
    version: 8,
    // Glyph endpoint required for any text-symbol layer (cluster counts, pick check,
    // cleanup star). Without this, text-field renders nothing — silently.
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources,
    layers,
  }
}

export function mapLegacyBasemapIdToTheme(id: string | undefined): BasemapTheme {
  if (!id) return DEFAULT_BASEMAP_THEME

  if (id === 'carto-dark' || id === 'stadia-alidade-smooth-dark') return 'dark'
  if (id === 'swisstopo-swissimage' || id === 'esri-world-imagery') return 'aerial'
  if (id === 'swisstopo-pixelkarte-farbe' || id === 'opentopomap') return 'topo'
  return 'standard'
}
