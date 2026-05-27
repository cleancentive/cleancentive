import { useEffect, useRef, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStore } from '../stores/mapStore'
import { useAuthStore } from '../stores/authStore'
import { useInsightsFilterStore, presetToSince, pickedUpFilterToParam } from '../stores/insightsFilterStore'
import { useBasemapStore } from '../stores/basemapStore'
import { resolveBasemapTheme, type ResolvedBasemap } from '../config/basemaps'
import { BasemapSwitcher } from './BasemapSwitcher'
import { API_BASE } from '../lib/apiBase'
import { parseMapState, serializeMapState, type MapViewState } from '../lib/mapUrlState'
import { useCopyToClipboard } from '../lib/useCopyToClipboard'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function wirePopupLinkNavigate(popup: maplibregl.Popup, navigate: (path: string) => void) {
  const link = popup.getElement()?.querySelector<HTMLAnchorElement>('.map-popup-link')
  if (!link) return
  link.addEventListener('click', (ev) => {
    // Let modifier / middle / right clicks fall through to native behavior
    // (cmd/ctrl/shift-click → new tab, middle-click → new tab, etc.)
    if (ev.button !== 0) return
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return
    ev.preventDefault()
    const href = link.getAttribute('href')
    if (href) navigate(href)
  })
}

function openSpotPopup(
  map: maplibregl.Map,
  feature: GeoJSON.Feature,
  navigate: (path: string) => void,
  popupCoord?: [number, number],
) {
  const geometry = feature.geometry as GeoJSON.Point
  const coords = popupCoord ?? (geometry.coordinates.slice() as [number, number])
  const p = feature.properties || {}
  const html = `
    <div class="map-popup">
      <img src="${API_BASE}/spots/${p.id}/thumbnail" alt="" class="map-popup-thumb" />
      <div class="map-popup-info">
        <strong>${p.topObject ? String(p.topObject).replace(/_/g, ' ') : (p.pickedUp === false ? 'Spot' : 'Pick')}</strong>
        <span>${formatDate(p.capturedAt)}</span>
        <span>${p.itemCount} item${p.itemCount !== 1 ? 's' : ''} detected</span>
        <a class="map-popup-link" href="/spots/${p.id}">Open spot &rarr;</a>
      </div>
    </div>
  `
  const popup = new maplibregl.Popup({ offset: 10 }).setLngLat(coords).setHTML(html).addTo(map)
  wirePopupLinkNavigate(popup, navigate)
}

function openCleanupPopup(
  map: maplibregl.Map,
  feature: GeoJSON.Feature,
  navigate: (path: string) => void,
) {
  const geometry = feature.geometry as GeoJSON.Point
  const coords = geometry.coordinates.slice() as [number, number]
  const p = feature.properties || {}
  const html = `
    <div class="map-popup">
      <div class="map-popup-info">
        <strong>${p.cleanupName || 'Cleanup'}</strong>
        ${p.locationName ? `<span>${p.locationName}</span>` : ''}
        ${p.startAt ? `<span>${formatDate(p.startAt)}</span>` : ''}
        <span>${p.spotCount} pick${p.spotCount !== 1 ? 's' : ''}</span>
        <a class="map-popup-link" href="/cleanups/${p.cleanupId}">Open cleanup &rarr;</a>
      </div>
    </div>
  `
  const popup = new maplibregl.Popup({ offset: 12 }).setLngLat(coords).setHTML(html).addTo(map)
  wirePopupLinkNavigate(popup, navigate)
}

function allLeavesShareCoords(leaves: GeoJSON.Feature[]): boolean {
  if (leaves.length < 2) return false
  const first = leaves[0].geometry as GeoJSON.Point
  const [refLng, refLat] = first.coordinates as [number, number]
  const eps = 1e-6
  return leaves.every((f) => {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number]
    return Math.abs(lng - refLng) < eps && Math.abs(lat - refLat) < eps
  })
}

// Tag each feature with stackCount (how many features share its exact coords)
// and stackPrimary (true on one representative per stack). The map uses
// stackPrimary + stackCount > 1 to render a single "+N" badge per stacked
// location at zoom levels above the cluster ceiling.
function annotateStacks(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const byKey = new Map<string, GeoJSON.Feature[]>()
  for (const f of fc.features) {
    if (f.geometry.type !== 'Point') continue
    const [lng, lat] = f.geometry.coordinates as [number, number]
    const key = `${lng.toFixed(6)}:${lat.toFixed(6)}`
    const list = byKey.get(key) ?? []
    list.push(f)
    byKey.set(key, list)
  }
  const result: GeoJSON.Feature[] = []
  for (const list of byKey.values()) {
    list.forEach((f, i) => {
      result.push({
        ...f,
        properties: {
          ...(f.properties ?? {}),
          stackCount: list.length,
          stackPrimary: i === 0,
        },
      })
    })
  }
  return { ...fc, features: result }
}

function toSourceSpec(source: ResolvedBasemap['layers'][number]['source']): maplibregl.RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: source.tiles,
    tileSize: source.tileSize ?? 256,
    attribution: source.attribution,
    ...(source.maxZoom ? { maxzoom: source.maxZoom } : {}),
  }
}

function buildStyle(resolved: ResolvedBasemap): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification['sources'] = {}
  const layers: maplibregl.LayerSpecification[] = []

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

function getMapView(map: maplibregl.Map) {
  const center = map.getCenter()
  const bounds = map.getBounds()
  return {
    center: { lon: center.lng, lat: center.lat },
    zoom: map.getZoom(),
    bounds: {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
  }
}

function getResolvedSignature(resolved: ResolvedBasemap): string {
  return `${resolved.theme}:${resolved.layers.map((layer) => layer.source.id).join('+')}`
}

// MapLibre IControl that exposes its DOM container to React via a setter,
// so React can portal arbitrary buttons into MapLibre's native control stack.
class ReactControlSlot implements maplibregl.IControl {
  private setSlot: (el: HTMLDivElement | null) => void
  private el: HTMLDivElement | null = null
  constructor(setSlot: (el: HTMLDivElement | null) => void) {
    this.setSlot = setSlot
  }
  onAdd(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    this.el = div
    this.setSlot(div)
    return div
  }
  onRemove(): void {
    this.el?.remove()
    this.el = null
    this.setSlot(null)
  }
}

export function MapPage() {
  const {
    spotGeoJson, cleanupGeoJson, isLoading, error, fetchMapData,
    heatMetric, setHeatMetric,
  } = useMapStore()
  const { user } = useAuthStore()
  const { datePreset, pickedUpFilter, myFilter, cleanupFilter } = useInsightsFilterStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { copy, copied } = useCopyToClipboard()

  // Hydrate stores from URL synchronously on first render so the map and data
  // effects below pick up the deep-linked filters/metric on their first run.
  // Zustand's setState during render is supported; the ref guard keeps this
  // single-shot across re-renders (incl. StrictMode double-invocation).
  const initialUrlStateRef = useRef<ReturnType<typeof parseMapState> | null>(null)
  if (initialUrlStateRef.current === null) {
    const parsed = parseMapState(searchParams)
    initialUrlStateRef.current = parsed
    if (parsed.datePreset !== undefined) useInsightsFilterStore.setState({ datePreset: parsed.datePreset })
    if (parsed.pickedUpFilter !== undefined) useInsightsFilterStore.setState({ pickedUpFilter: parsed.pickedUpFilter })
    if (parsed.myFilter !== undefined) useInsightsFilterStore.setState({ myFilter: parsed.myFilter })
    if (parsed.cleanupFilter !== undefined) useInsightsFilterStore.setState({ cleanupFilter: parsed.cleanupFilter })
    if (parsed.heatMetric !== undefined) useMapStore.setState({ heatMetric: parsed.heatMetric })
  }
  const initialUrlState = initialUrlStateRef.current

  const teamId = user?.active_team_id ?? undefined
  const cleanupDateId = cleanupFilter?.kind === 'date' ? cleanupFilter.cleanupDateId : undefined
  const cleanupId = cleanupFilter?.kind === 'cleanup' ? cleanupFilter.cleanupId : undefined

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // A URL-supplied viewport counts as user intent: prevent auto-fit-to-data
  // from overriding the deep-linked view on first data load.
  const userInteractedRef = useRef(initialUrlState.view !== undefined)
  const hasFittedRef = useRef(initialUrlState.view !== undefined)
  const initialViewRef = useRef<MapViewState | null>(initialUrlState.view ?? null)
  const [viewState, setViewState] = useState<MapViewState | null>(initialUrlState.view ?? null)
  const [mapReady, setMapReady] = useState(false)
  const [ctrlSlot, setCtrlSlot] = useState<HTMLDivElement | null>(null)
  const selectedTheme = useBasemapStore((s) => s.selectedTheme)
  const activeResolvedSignatureRef = useRef<string>('')
  const setupOverlaysRef = useRef<(() => void) | null>(null)
  const spiderRef = useRef<{ markers: maplibregl.Marker[]; openedAtZoom: number } | null>(null)
  const closeSpiderRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    fetchMapData({
      team_id: teamId,
      cleanup_id: cleanupId,
      cleanup_date_id: cleanupDateId,
      since: presetToSince(datePreset),
      picked_up: pickedUpFilterToParam(pickedUpFilter),
      user_id: myFilter ? user?.id : undefined,
    })
  }, [fetchMapData, teamId, cleanupId, cleanupDateId, datePreset, pickedUpFilter, myFilter, user?.id])

  // Reset userInteracted when filters change so auto-fit fires again
  useEffect(() => {
    userInteractedRef.current = false
  }, [teamId, cleanupId, cleanupDateId, datePreset, pickedUpFilter, myFilter])

  // Initialize map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const initialTheme = useBasemapStore.getState().selectedTheme
    const initialView = initialViewRef.current
    const initialCenter: [number, number] = initialView ? [initialView.lon, initialView.lat] : [0, 20]
    const initialZoom = initialView?.zoom ?? 2
    const initialResolved = resolveBasemapTheme(initialTheme, {
      center: { lon: initialCenter[0], lat: initialCenter[1] },
      zoom: initialZoom,
    })
    activeResolvedSignatureRef.current = getResolvedSignature(initialResolved)

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: buildStyle(initialResolved),
      center: initialCenter,
      zoom: initialZoom,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
      }),
      'top-right',
    )
    // Slot for our custom controls (basemap + share), portaled in from React
    // so they share styling and stacking with the native MapLibre controls.
    map.addControl(new ReactControlSlot(setCtrlSlot), 'top-right')

    map.on('mousedown', () => { userInteractedRef.current = true })
    map.on('wheel', () => { userInteractedRef.current = true })
    map.on('touchstart', () => { userInteractedRef.current = true })

    // Add overlay sources + layers; runs on initial load AND after every setStyle.
    // Idempotent: setStyle wipes sources, so a second call after a basemap swap
    // re-adds them; if sources already exist, this is a no-op.
    function setupOverlays() {
      if (map.getSource('spots-source')) return
      const pickBase = getCssVar('--color-entity-pick')
      const pickDark = getCssVar('--color-entity-pick-dark')
      const spotBase = getCssVar('--color-entity-spot')
      const spotDark = getCssVar('--color-entity-spot-dark')
      const cleanupBase = getCssVar('--color-entity-cleanup')
      const cleanupDark = getCssVar('--color-entity-cleanup-dark')

      map.addSource('spots-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
        // Aggregate pickCount per cluster so we can color the cluster by composition.
        clusterProperties: {
          pickCount: ['+', ['case', ['==', ['get', 'pickedUp'], true], 1, 0]],
        },
      })

      // Separate non-clustered source for the heat layer so weights (itemCount,
      // totalWeight) reflect actual per-spot values instead of cluster counts.
      map.addSource('spots-heat-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      const { heatMetric: hm } = useMapStore.getState()
      const heatProp = hm === 'mass' ? 'totalWeight' : 'itemCount'

      // Two heatmap layers on the same source: picks paint emerald (cleaned =
      // positive signal), unpicked spots paint red (still needs action). Peak
      // emerald tops out at emerald-600 so the emerald-800 pick markers stay
      // visible inside hot green zones.
      map.addLayer({
        id: 'picks-heat',
        type: 'heatmap',
        source: 'spots-heat-source',
        filter: ['==', ['get', 'pickedUp'], true],
        paint: {
          'heatmap-weight': ['coalesce', ['get', heatProp], 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 11, 2, 22, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 6, 11, 30, 22, 60],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'],
            0, 0.85,
            9, 0.85,
            14, 0.55,
            22, 0.45,
          ],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.1,  'rgba(167,243,208,0.45)',
            0.35, 'rgba(52,211,153,0.70)',
            0.65, 'rgba(16,185,129,0.85)',
            1,    'rgba(5,150,105,0.95)',
          ],
        },
      })

      map.addLayer({
        id: 'spots-heat',
        type: 'heatmap',
        source: 'spots-heat-source',
        filter: ['==', ['get', 'pickedUp'], false],
        paint: {
          'heatmap-weight': ['coalesce', ['get', heatProp], 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 11, 2, 22, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 6, 11, 30, 22, 60],
          // Red is intrinsically more salient than green at equal opacity, so
          // dial this ramp down to keep red from dominating mixed views.
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'],
            0, 0.60,
            9, 0.60,
            14, 0.40,
            22, 0.32,
          ],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.1,  'rgba(254,202,202,0.45)',
            0.35, 'rgba(248,113,113,0.70)',
            0.65, 'rgba(239,68,68,0.85)',
            1,    'rgba(220,38,38,0.95)',
          ],
        },
      })

      // Cluster fill reflects composition along the pick/spot color spectrum:
      // dark green (all clean) → green (mostly clean) → red (mostly needs action)
      // → dark red (all needs action). Density signal moves to the radius step.
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'spots-source',
        filter: ['has', 'point_count'],
        minzoom: 11,
        paint: {
          'circle-color': [
            'case',
            // All picks
            ['==', ['get', 'pickCount'], ['get', 'point_count']], pickDark,
            // No picks (all unpicked)
            ['==', ['get', 'pickCount'], 0], spotDark,
            // Majority picks (>50%)
            ['>', ['*', ['get', 'pickCount'], 2], ['get', 'point_count']], pickBase,
            // Otherwise: mixed but majority unpicked
            spotBase,
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            18, 10,
            24, 50,
            30,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      })

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'spots-source',
        filter: ['has', 'point_count'],
        minzoom: 11,
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Semibold'],
          'text-size': 13,
        },
        paint: {
          'text-color': '#ffffff',
        },
      })

      // Picks: filled dark-green circle with white check glyph on top.
      map.addLayer({
        id: 'unclustered-pick',
        type: 'circle',
        source: 'spots-source',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'pickedUp'], true]],
        paint: {
          'circle-color': pickDark,
          'circle-radius': 11,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      })

      // Spots (unpicked): dark-red fill + white stroke. Mirrors the pick marker
      // recipe (dark entity color + white stroke) and the spot-dark token sits
      // one shade darker than the red heatmap peak so the marker stays legible
      // inside hot zones.
      map.addLayer({
        id: 'unclustered-spot',
        type: 'circle',
        source: 'spots-source',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'pickedUp'], false]],
        paint: {
          'circle-color': spotDark,
          'circle-radius': 11,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      })

      // Pick check glyph. allow-overlap + ignore-placement so every pick keeps
      // its glyph; without these MapLibre's collision detection drops most.
      map.addLayer({
        id: 'unclustered-pick-glyph',
        type: 'symbol',
        source: 'spots-source',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'pickedUp'], true]],
        layout: {
          'text-field': '✓',
          'text-font': ['Open Sans Semibold'],
          'text-size': 13,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' },
      })

      // Stack-count badge for unclustered points that share exact coords with
      // siblings. Renders once per stack (filtered to stackPrimary), top-right
      // of the marker. Tells the user "click here to fan N spots out."
      map.addLayer({
        id: 'unclustered-stack-badge',
        type: 'symbol',
        source: 'spots-source',
        filter: ['all',
          ['!', ['has', 'point_count']],
          ['==', ['get', 'stackPrimary'], true],
          ['>', ['get', 'stackCount'], 1],
        ],
        layout: {
          'text-field': ['get', 'stackCount'],
          'text-font': ['Open Sans Semibold'],
          'text-size': 11,
          'text-offset': [0.9, -0.9],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#1f2937',
          'text-halo-width': 2,
        },
      })

      // Invisible larger hit target for tap accessibility (esp. iOS).
      // Sits on top of the visible markers; clicks within ~36px diameter open the popup.
      map.addLayer({
        id: 'unclustered-spot-hit',
        type: 'circle',
        source: 'spots-source',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#000',
          'circle-opacity': 0,
          'circle-radius': 18,
        },
      })

      map.addSource('cleanups-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'cleanup-locations',
        type: 'circle',
        source: 'cleanups-source',
        paint: {
          'circle-color': cleanupDark || cleanupBase,
          'circle-radius': 12,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#fff',
        },
      })

      map.addLayer({
        id: 'cleanup-glyph',
        type: 'symbol',
        source: 'cleanups-source',
        layout: {
          'text-field': '★',
          'text-font': ['Open Sans Semibold'],
          'text-size': 14,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' },
      })

      // Spider-fan leader-lines source + layer (drawn last so it sits above other
      // map layers; DOM markers are always above the canvas regardless).
      map.addSource('spider-lines-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'spider-lines',
        type: 'line',
        source: 'spider-lines-source',
        paint: {
          'line-color': '#ffffff',
          'line-width': 1.5,
          'line-opacity': 0.7,
        },
      })

      // Re-apply current data after a setStyle wipe.
      const current = useMapStore.getState()
      if (current.spotGeoJson) {
        const annotated = annotateStacks(current.spotGeoJson)
        ;(map.getSource('spots-source') as maplibregl.GeoJSONSource | undefined)?.setData(annotated)
        ;(map.getSource('spots-heat-source') as maplibregl.GeoJSONSource | undefined)?.setData(annotated)
      }
      if (current.cleanupGeoJson) {
        ;(map.getSource('cleanups-source') as maplibregl.GeoJSONSource | undefined)?.setData(current.cleanupGeoJson)
      }
    }

    setupOverlaysRef.current = setupOverlays
    map.on('style.load', setupOverlays)
    map.on('styledata', setupOverlays)

    // Close any open spider-fan and clear its leader lines + markers.
    function closeSpider() {
      if (!spiderRef.current) return
      for (const m of spiderRef.current.markers) m.remove()
      spiderRef.current = null
      const src = map.getSource('spider-lines-source') as maplibregl.GeoJSONSource | undefined
      src?.setData({ type: 'FeatureCollection', features: [] })
    }
    closeSpiderRef.current = closeSpider

    // Fan a set of co-located features out radially around a centroid in pixel
    // space. Used both when a cluster won't expand (co-located leaves) AND when
    // zoom > clusterMaxZoom and individual features stack at identical coords.
    function spiderFan(leaves: GeoJSON.Feature[], center: [number, number]) {
      closeSpider()
      const radius = Math.min(80, 36 + Math.max(0, leaves.length - 4) * 5)
      const centerPx = map.project(center)
      const markers: maplibregl.Marker[] = []
      const lines: GeoJSON.Feature<GeoJSON.LineString>[] = []
      leaves.forEach((leaf, i) => {
        const angle = (2 * Math.PI * i) / leaves.length - Math.PI / 2
        const x = centerPx.x + Math.cos(angle) * radius
        const y = centerPx.y + Math.sin(angle) * radius
        const offset = map.unproject([x, y])
        const offsetCoord: [number, number] = [offset.lng, offset.lat]
        const props = leaf.properties || {}
        const isPick = props.pickedUp !== false
        const el = document.createElement('div')
        el.className = `map-spider-marker map-spider-marker--${isPick ? 'pick' : 'spot'}`
        el.textContent = isPick ? '✓' : ''
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(offsetCoord)
          .addTo(map)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          openSpotPopup(map, leaf, navigate, offsetCoord)
        })
        markers.push(marker)
        lines.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [center, offsetCoord] },
          properties: {},
        })
      })
      spiderRef.current = { markers, openedAtZoom: map.getZoom() }
      const src = map.getSource('spider-lines-source') as maplibregl.GeoJSONSource | undefined
      src?.setData({ type: 'FeatureCollection', features: lines })
    }

    // Click + cursor handlers — bound once. MapLibre matches by layer id, so they
    // continue to fire correctly after layers are removed/re-added by setStyle.
    map.on('click', 'clusters', async (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      if (!features.length) return
      const clusterId = features[0].properties.cluster_id as number
      const source = map.getSource('spots-source') as maplibregl.GeoJSONSource
      const center = (features[0].geometry as GeoJSON.Point).coordinates as [number, number]
      // If all leaves share coords, zoom won't separate them — fan them out instead.
      const leaves = (await source.getClusterLeaves(clusterId, Infinity, 0)) as GeoJSON.Feature[]
      if (allLeavesShareCoords(leaves)) {
        spiderFan(leaves, center)
        return
      }
      // Zooming into a normal cluster — close any prior spider first.
      closeSpider()
      const zoom = await source.getClusterExpansionZoom(clusterId)
      map.easeTo({ center, zoom })
    })

    // Spider persists across pan/zoom-in (markers float with the map). On
    // zoom-OUT past 0.5 levels below where it opened, collapse so the user
    // sees the cluster badge again instead of stale fanned markers.
    map.on('zoom', () => {
      if (!spiderRef.current) return
      if (map.getZoom() < spiderRef.current.openedAtZoom - 0.5) closeSpider()
    })

    // Closes on explicit user actions: canvas click, Escape, or clicking a
    // non-stacked marker (handled in the layer-specific handlers below).
    map.on('click', (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['clusters', 'unclustered-spot-hit', 'cleanup-locations'] })
      if (hit.length === 0) closeSpider()
    })

    map.on('click', 'unclustered-spot-hit', (e) => {
      if (!e.features?.length) return
      const clicked = e.features[0]
      const clickedCoord = (clicked.geometry as GeoJSON.Point).coordinates as [number, number]
      // Above clusterMaxZoom, points are unclustered. If multiple share the exact
      // click coord they render as one visual marker — fan them out so the user
      // can reach the underlying spots.
      const all = useMapStore.getState().spotGeoJson?.features ?? []
      const stacked = all.filter((f) => {
        if (f.geometry.type !== 'Point') return false
        const [lng, lat] = f.geometry.coordinates as [number, number]
        return Math.abs(lng - clickedCoord[0]) < 1e-6 && Math.abs(lat - clickedCoord[1]) < 1e-6
      })
      if (stacked.length > 1) {
        spiderFan(stacked, clickedCoord)
        return
      }
      closeSpider()
      openSpotPopup(map, clicked, navigate)
    })

    map.on('click', 'cleanup-locations', (e) => {
      if (!e.features?.length) return
      closeSpider()
      openCleanupPopup(map, e.features[0], navigate)
    })

    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'unclustered-spot-hit', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'unclustered-spot-hit', () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'cleanup-locations', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'cleanup-locations', () => { map.getCanvas().style.cursor = '' })

    map.on('load', () => { setMapReady(true) })

    mapRef.current = map

    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply basemap theme changes by swapping the MapLibre style.
  // setStyle wipes all sources/layers; the style.load + styledata listeners
  // re-add them. We also call setupOverlays explicitly on the next 'idle'
  // tick as a belt-and-braces fallback (some MapLibre 4.x edge cases drop
  // 'style.load' for repeat setStyle calls).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const resolved = resolveBasemapTheme(selectedTheme, getMapView(map))
    const signature = getResolvedSignature(resolved)
    if (activeResolvedSignatureRef.current === signature) return
    activeResolvedSignatureRef.current = signature
    map.setStyle(buildStyle(resolved))
    map.once('idle', () => { setupOverlaysRef.current?.() })
  }, [selectedTheme, mapReady])

  // Track viewport in component state so the URL sync effect picks up pan/zoom.
  // MapLibre's moveend fires once when the gesture stops — natural debounce.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    function syncView() {
      const v = getMapView(map!)
      setViewState({ lon: v.center.lon, lat: v.center.lat, zoom: v.zoom })
    }
    syncView()
    map.on('moveend', syncView)
    return () => { map.off('moveend', syncView) }
  }, [mapReady])

  // Sync filters + heat metric + viewport to the URL. replace: true so panning
  // doesn't pollute browser history. On first run with a URL-supplied state the
  // serialized output matches the incoming search params, so this is a no-op
  // replaceState rather than a destructive write.
  useEffect(() => {
    const next = serializeMapState({
      datePreset, pickedUpFilter, myFilter, cleanupFilter, heatMetric,
      view: viewState ?? undefined,
    })
    // Avoid a redundant replaceState when nothing changed (cheap string compare).
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [datePreset, pickedUpFilter, myFilter, cleanupFilter, heatMetric, viewState, searchParams, setSearchParams])

  const handleShare = useCallback(() => {
    copy(window.location.href)
  }, [copy])

  useEffect(() => {
    const mapInstance = mapRef.current
    if (!mapInstance || !mapReady) return
    const map = mapInstance

    function onMoveEnd() {
      if (selectedTheme !== 'aerial' && selectedTheme !== 'topo') return
      const resolved = resolveBasemapTheme(selectedTheme, getMapView(map))
      const signature = getResolvedSignature(resolved)
      if (activeResolvedSignatureRef.current === signature) return
      activeResolvedSignatureRef.current = signature
      map.setStyle(buildStyle(resolved))
      map.once('idle', () => { setupOverlaysRef.current?.() })
    }

    map.on('moveend', onMoveEnd)
    return () => {
      map.off('moveend', onMoveEnd)
    }
  }, [selectedTheme, mapReady])

  // Fit bounds helper
  const fitToData = useCallback((spots: GeoJSON.FeatureCollection, cleanups: GeoJSON.FeatureCollection, animate: boolean) => {
    const map = mapRef.current
    if (!map) return

    const bounds = new maplibregl.LngLatBounds()
    let hasPoints = false

    for (const fc of [spots, cleanups]) {
      for (const f of fc.features) {
        if (f.geometry.type === 'Point') {
          bounds.extend(f.geometry.coordinates as [number, number])
          hasPoints = true
        }
      }
    }

    if (hasPoints) {
      map.fitBounds(bounds, { padding: 50, maxZoom: 15, animate })
    }
  }, [])

  // Update map sources when data changes or map becomes ready
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (spotGeoJson) {
      const annotated = annotateStacks(spotGeoJson)
      const source = map.getSource('spots-source') as maplibregl.GeoJSONSource | undefined
      if (source) source.setData(annotated)
      const heatSource = map.getSource('spots-heat-source') as maplibregl.GeoJSONSource | undefined
      if (heatSource) heatSource.setData(annotated)
    }

    if (cleanupGeoJson) {
      const source = map.getSource('cleanups-source') as maplibregl.GeoJSONSource | undefined
      if (source) source.setData(cleanupGeoJson)
    }

    if (spotGeoJson && cleanupGeoJson && !userInteractedRef.current) {
      const animate = hasFittedRef.current
      hasFittedRef.current = true
      fitToData(spotGeoJson, cleanupGeoJson, animate)
    }
  }, [spotGeoJson, cleanupGeoJson, fitToData, mapReady])

  // Escape key collapses any open spider-fan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSpiderRef.current?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Apply heat-metric changes to the heat layer.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (!map.getLayer('spots-heat') || !map.getLayer('picks-heat')) return
    const heatProp = heatMetric === 'mass' ? 'totalWeight' : 'itemCount'
    const weight = ['coalesce', ['get', heatProp], 1]
    map.setPaintProperty('picks-heat', 'heatmap-weight', weight)
    map.setPaintProperty('spots-heat', 'heatmap-weight', weight)
  }, [heatMetric, mapReady])

  const hasData = (spotGeoJson?.features.length ?? 0) > 0 || (cleanupGeoJson?.features.length ?? 0) > 0

  return (
    <div className="map-page">
      <div className="map-container" ref={mapContainerRef} />
      {/* Render BasemapSwitcher first so its trigger portals into the slot
          before the share button — keeps DOM order stable: basemap on top,
          share below (within MapLibre's top-right control stack). */}
      <BasemapSwitcher triggerSlot={ctrlSlot} />
      {ctrlSlot && createPortal(
        <button
          type="button"
          className="map-share-control maplibregl-ctrl-icon"
          onClick={handleShare}
          aria-label={copied ? 'Link copied' : 'Copy shareable link to this map view'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {copied ? (
              <path d="M5 13l4 4L19 7" />
            ) : (
              <>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </>
            )}
          </svg>
        </button>,
        ctrlSlot,
      )}
      <div className="map-heat-control">
        <div className="map-heat-control__row" role="radiogroup" aria-label="Heat map metric">
          <button
            type="button"
            role="radio"
            aria-checked={heatMetric === 'items'}
            className={`map-heat-control__btn${heatMetric === 'items' ? ' is-active' : ''}`}
            onClick={() => setHeatMetric('items')}
          >
            Items
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={heatMetric === 'mass'}
            className={`map-heat-control__btn${heatMetric === 'mass' ? ' is-active' : ''}`}
            onClick={() => setHeatMetric('mass')}
          >
            Mass
          </button>
        </div>
      </div>
      {isLoading && (
        <div className="map-overlay">Loading...</div>
      )}
      {error && (
        <div className="map-overlay map-overlay--error">{error}</div>
      )}
      {!isLoading && !error && !hasData && spotGeoJson && (
        <div className="map-overlay">No picks found for these filters</div>
      )}
    </div>
  )
}
