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
const ATTR_CARTO =
  ATTR_OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>'
const ATTR_OPENTOPO =
  ATTR_OSM +
  ' | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
const ATTR_ESRI = 'Tiles &copy; Esri'

function carto(variant: string): string[] {
  return ['a', 'b', 'c', 'd'].map(
    (s) => `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`,
  )
}

function swisstopo(layer: string, ext: 'jpeg' | 'png'): string[] {
  return [
    `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.${ext}`,
  ]
}

export const DEFAULT_BASEMAP_THEME: BasemapTheme = 'standard'

export const BASEMAP_THEMES: ReadonlyArray<{ id: BasemapTheme; label: string }> = [
  { id: 'standard', label: 'Standard' },
  { id: 'aerial', label: 'Aerial' },
  { id: 'topo', label: 'Topo' },
  { id: 'dark', label: 'Dark' },
]

const SOURCES = {
  standardGlobal: {
    id: 'carto-voyager',
    label: 'Standard',
    tiles: carto('rastertiles/voyager'),
    attribution: ATTR_CARTO,
    maxZoom: 20,
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
  darkGlobal: {
    id: 'carto-dark',
    label: 'Dark',
    tiles: carto('dark_all'),
    attribution: ATTR_CARTO,
    maxZoom: 20,
  } satisfies BasemapSource,
}

export function getStandardBasemapSource(): BasemapSource {
  return SOURCES.standardGlobal
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
    return { theme, layers: [{ source: SOURCES.standardGlobal }] }
  }
  if (theme === 'dark') {
    return { theme, layers: [{ source: SOURCES.darkGlobal }] }
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

export function mapLegacyBasemapIdToTheme(id: string | undefined): BasemapTheme {
  if (!id) return DEFAULT_BASEMAP_THEME

  if (id === 'carto-dark' || id === 'stadia-alidade-smooth-dark') return 'dark'
  if (id === 'swisstopo-swissimage' || id === 'esri-world-imagery') return 'aerial'
  if (id === 'swisstopo-pixelkarte-farbe' || id === 'opentopomap') return 'topo'
  return 'standard'
}
