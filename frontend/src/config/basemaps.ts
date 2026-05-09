export interface BasemapDef {
  id: string
  label: string
  tiles: string[]
  attribution: string
  tileSize?: number
  maxZoom?: number
  stewardOnly: boolean
  requiresKey?: 'stadia'
}

const ATTR_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const ATTR_SWISSTOPO = '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>'
const ATTR_CARTO =
  ATTR_OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>'
const ATTR_OPENTOPO =
  ATTR_OSM +
  ' | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
const ATTR_CYCLOSM =
  ATTR_OSM +
  ' | <a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases">CyclOSM</a>'
const ATTR_OPNV =
  ATTR_OSM +
  ' | Map <a href="https://memomaps.de/">memomaps.de</a> (CC-BY-SA)'
const ATTR_ESRI = 'Tiles &copy; Esri'
const ATTR_STADIA =
  '&copy; <a href="https://www.stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> ' +
  ATTR_OSM
const ATTR_STAMEN =
  '&copy; <a href="https://www.stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://www.stamen.com/">Stamen Design</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> ' +
  ATTR_OSM

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

function stadia(variant: string, ext: 'png' | 'jpg', key: string): string[] {
  return [`https://tiles.stadiamaps.com/tiles/${variant}/{z}/{x}/{y}.${ext}?api_key=${key}`]
}

const PUBLIC_BASEMAPS: BasemapDef[] = [
  {
    id: 'osm',
    label: 'Standard',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: ATTR_OSM,
    maxZoom: 19,
    stewardOnly: false,
  },
  {
    id: 'carto-voyager',
    label: 'Clean',
    tiles: carto('rastertiles/voyager'),
    attribution: ATTR_CARTO,
    maxZoom: 20,
    stewardOnly: false,
  },
  {
    id: 'swisstopo-pixelkarte-farbe',
    label: 'Topo CH',
    tiles: swisstopo('ch.swisstopo.pixelkarte-farbe', 'jpeg'),
    attribution: ATTR_SWISSTOPO,
    maxZoom: 19,
    stewardOnly: false,
  },
  {
    id: 'swisstopo-swissimage',
    label: 'Aerial',
    tiles: swisstopo('ch.swisstopo.swissimage', 'jpeg'),
    attribution: ATTR_SWISSTOPO,
    maxZoom: 19,
    stewardOnly: false,
  },
]

const STEWARD_NO_KEY: BasemapDef[] = [
  {
    id: 'carto-positron',
    label: 'Carto Positron',
    tiles: carto('light_all'),
    attribution: ATTR_CARTO,
    maxZoom: 20,
    stewardOnly: true,
  },
  {
    id: 'carto-dark',
    label: 'Carto Dark Matter',
    tiles: carto('dark_all'),
    attribution: ATTR_CARTO,
    maxZoom: 20,
    stewardOnly: true,
  },
  {
    id: 'swisstopo-pixelkarte-grau',
    label: 'Swiss Pixelkarte (gray)',
    tiles: swisstopo('ch.swisstopo.pixelkarte-grau', 'jpeg'),
    attribution: ATTR_SWISSTOPO,
    maxZoom: 19,
    stewardOnly: true,
  },
  {
    id: 'swisstopo-pixelkarte-winter',
    label: 'Swiss Pixelkarte WINTER',
    tiles: swisstopo('ch.swisstopo.pixelkarte-farbe-winter', 'jpeg'),
    attribution: ATTR_SWISSTOPO,
    maxZoom: 19,
    stewardOnly: true,
  },
  {
    id: 'swisstopo-dufour',
    label: 'Swiss Dufour (1845–1865)',
    tiles: swisstopo('ch.swisstopo.hiks-dufour', 'png'),
    attribution: ATTR_SWISSTOPO,
    maxZoom: 18,
    stewardOnly: true,
  },
  {
    id: 'swisstopo-siegfried',
    label: 'Swiss Siegfried (1870–1949)',
    tiles: swisstopo('ch.swisstopo.hiks-siegfried', 'png'),
    attribution: ATTR_SWISSTOPO,
    maxZoom: 18,
    stewardOnly: true,
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    tiles: ['a', 'b', 'c'].map(
      (s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`,
    ),
    attribution: ATTR_OPENTOPO,
    maxZoom: 17,
    stewardOnly: true,
  },
  {
    id: 'cyclosm',
    label: 'CyclOSM',
    tiles: ['a', 'b', 'c'].map(
      (s) =>
        `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`,
    ),
    attribution: ATTR_CYCLOSM,
    maxZoom: 20,
    stewardOnly: true,
  },
  {
    id: 'opnvkarte',
    label: 'ÖPNV Karte (Transit)',
    tiles: ['https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png'],
    attribution: ATTR_OPNV,
    maxZoom: 18,
    stewardOnly: true,
  },
  {
    id: 'esri-world-imagery',
    label: 'Esri World Imagery',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: ATTR_ESRI,
    maxZoom: 19,
    stewardOnly: true,
  },
  {
    id: 'esri-shaded-relief',
    label: 'Esri Shaded Relief',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: ATTR_ESRI,
    maxZoom: 13,
    stewardOnly: true,
  },
]

function stadiaBasemaps(key: string): BasemapDef[] {
  return [
    {
      id: 'stadia-alidade-smooth',
      label: 'Stadia Alidade Smooth',
      tiles: stadia('alidade_smooth', 'png', key),
      attribution: ATTR_STADIA,
      maxZoom: 20,
      stewardOnly: true,
      requiresKey: 'stadia',
    },
    {
      id: 'stadia-alidade-smooth-dark',
      label: 'Stadia Alidade Smooth Dark',
      tiles: stadia('alidade_smooth_dark', 'png', key),
      attribution: ATTR_STADIA,
      maxZoom: 20,
      stewardOnly: true,
      requiresKey: 'stadia',
    },
    {
      id: 'stadia-osm-bright',
      label: 'Stadia OSM Bright',
      tiles: stadia('osm_bright', 'png', key),
      attribution: ATTR_STADIA,
      maxZoom: 20,
      stewardOnly: true,
      requiresKey: 'stadia',
    },
    {
      id: 'stadia-outdoors',
      label: 'Stadia Outdoors',
      tiles: stadia('outdoors', 'png', key),
      attribution: ATTR_STADIA,
      maxZoom: 20,
      stewardOnly: true,
      requiresKey: 'stadia',
    },
    {
      id: 'stamen-watercolor',
      label: 'Stamen Watercolor',
      tiles: stadia('stamen_watercolor', 'jpg', key),
      attribution: ATTR_STAMEN,
      maxZoom: 16,
      stewardOnly: true,
      requiresKey: 'stadia',
    },
    {
      id: 'stamen-toner',
      label: 'Stamen Toner',
      tiles: stadia('stamen_toner', 'png', key),
      attribution: ATTR_STAMEN,
      maxZoom: 20,
      stewardOnly: true,
      requiresKey: 'stadia',
    },
    {
      id: 'stamen-terrain',
      label: 'Stamen Terrain',
      tiles: stadia('stamen_terrain', 'png', key),
      attribution: ATTR_STAMEN,
      maxZoom: 18,
      stewardOnly: true,
      requiresKey: 'stadia',
    },
  ]
}

export const DEFAULT_BASEMAP_ID = 'osm'

export function getBasemaps(): BasemapDef[] {
  const stadiaKey =
    typeof window !== 'undefined'
      ? window.__CLEANCENTIVE_CONFIG__?.stadiaApiKey
      : undefined
  const stadia = stadiaKey ? stadiaBasemaps(stadiaKey) : []
  return [...PUBLIC_BASEMAPS, ...STEWARD_NO_KEY, ...stadia]
}

export function getPublicBasemaps(): BasemapDef[] {
  return PUBLIC_BASEMAPS
}

export function getBasemapById(id: string): BasemapDef | undefined {
  return getBasemaps().find((b) => b.id === id)
}
