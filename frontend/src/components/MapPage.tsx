import { useEffect, useRef, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStore } from '../stores/mapStore'
import { useAuthStore } from '../stores/authStore'
import { useInsightsFilterStore, presetToSince, pickedUpFilterToParam } from '../stores/insightsFilterStore'
import { useBasemapStore } from '../stores/basemapStore'
import { getBasemapById, type BasemapDef } from '../config/basemaps'
import { BasemapSwitcher } from './BasemapSwitcher'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function buildStyle(basemap: BasemapDef): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: basemap.tiles,
        tileSize: basemap.tileSize ?? 256,
        attribution: basemap.attribution,
        ...(basemap.maxZoom ? { maxzoom: basemap.maxZoom } : {}),
      },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  }
}

export function MapPage() {
  const { spotGeoJson, cleanupGeoJson, isLoading, error, fetchMapData } = useMapStore()
  const { user } = useAuthStore()
  const { datePreset, pickedUpFilter, myFilter, cleanupFilter } = useInsightsFilterStore()
  const navigate = useNavigate()

  const teamId = user?.active_team_id ?? undefined
  const cleanupDateId = cleanupFilter?.kind === 'date' ? cleanupFilter.cleanupDateId : undefined
  const cleanupId = cleanupFilter?.kind === 'cleanup' ? cleanupFilter.cleanupId : undefined

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const userInteractedRef = useRef(false)
  const hasFittedRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)
  const selectedBasemapId = useBasemapStore((s) => s.selectedId)
  const activeBasemapIdRef = useRef<string>(selectedBasemapId)
  const setupOverlaysRef = useRef<(() => void) | null>(null)

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

    const initialBasemap =
      getBasemapById(useBasemapStore.getState().selectedId) ?? getBasemapById('osm')!

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: buildStyle(initialBasemap),
      center: [0, 20],
      zoom: 2,
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

    map.on('mousedown', () => { userInteractedRef.current = true })
    map.on('wheel', () => { userInteractedRef.current = true })
    map.on('touchstart', () => { userInteractedRef.current = true })

    // Add overlay sources + layers; runs on initial load AND after every setStyle.
    // Idempotent: setStyle wipes sources, so a second call after a basemap swap
    // re-adds them; if sources already exist, this is a no-op.
    function setupOverlays() {
      if (map.getSource('spots-source')) return
      const spotBase = getCssVar('--color-entity-spot')
      const spotLight = getCssVar('--color-entity-spot-light')
      const spotDark = getCssVar('--color-entity-spot-dark')
      const pickBase = getCssVar('--color-entity-pick')
      const cleanupBase = getCssVar('--color-entity-cleanup')

      map.addSource('spots-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      })

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'spots-source',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            spotLight, 10,
            spotBase, 50,
            spotDark,
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
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 13,
        },
        paint: {
          'text-color': '#333',
        },
      })

      map.addLayer({
        id: 'unclustered-spot',
        type: 'circle',
        source: 'spots-source',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'case',
            ['==', ['get', 'pickedUp'], true],
            pickBase,
            spotBase,
          ],
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
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
          'circle-color': cleanupBase,
          'circle-radius': 10,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#fff',
        },
      })

      // Re-apply current data after a setStyle wipe.
      const current = useMapStore.getState()
      if (current.spotGeoJson) {
        ;(map.getSource('spots-source') as maplibregl.GeoJSONSource | undefined)?.setData(current.spotGeoJson)
      }
      if (current.cleanupGeoJson) {
        ;(map.getSource('cleanups-source') as maplibregl.GeoJSONSource | undefined)?.setData(current.cleanupGeoJson)
      }
    }

    setupOverlaysRef.current = setupOverlays
    map.on('style.load', setupOverlays)
    map.on('styledata', setupOverlays)

    // Click + cursor handlers — bound once. MapLibre matches by layer id, so they
    // continue to fire correctly after layers are removed/re-added by setStyle.
    map.on('click', 'clusters', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      if (!features.length) return
      const clusterId = features[0].properties.cluster_id
      const source = map.getSource('spots-source') as maplibregl.GeoJSONSource
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const geometry = features[0].geometry as GeoJSON.Point
        map.easeTo({ center: geometry.coordinates as [number, number], zoom })
      })
    })

    map.on('click', 'unclustered-spot', (e) => {
      if (!e.features?.length) return
      const f = e.features[0]
      const geometry = f.geometry as GeoJSON.Point
      const coords = geometry.coordinates.slice() as [number, number]
      const p = f.properties
      const html = `
        <div class="map-popup">
          <img src="${import.meta.env.VITE_API_URL || '/api/v1'}/spots/${p.id}/thumbnail" alt="" class="map-popup-thumb" />
          <div class="map-popup-info">
            <strong>${p.topObject ? p.topObject.replace(/_/g, ' ') : (p.pickedUp === false ? 'Spot' : 'Pick')}</strong>
            <span>${formatDate(p.capturedAt)}</span>
            <span>${p.itemCount} item${p.itemCount !== 1 ? 's' : ''} detected</span>
            <a class="map-popup-link" href="/spots/${p.id}" data-spot-id="${p.id}">Open spot &rarr;</a>
          </div>
        </div>
      `
      const popup = new maplibregl.Popup({ offset: 10 }).setLngLat(coords).setHTML(html).addTo(map)
      const popupEl = popup.getElement()
      const link = popupEl?.querySelector<HTMLAnchorElement>('.map-popup-link')
      if (link) {
        link.addEventListener('click', (ev) => {
          ev.preventDefault()
          navigate(`/spots/${link.dataset.spotId}`)
        })
      }
    })

    map.on('click', 'cleanup-locations', (e) => {
      if (!e.features?.length) return
      const f = e.features[0]
      const geometry = f.geometry as GeoJSON.Point
      const coords = geometry.coordinates.slice() as [number, number]
      const p = f.properties
      const html = `
        <div class="map-popup">
          <div class="map-popup-info">
            <strong>${p.cleanupName || 'Cleanup'}</strong>
            ${p.locationName ? `<span>${p.locationName}</span>` : ''}
            ${p.startAt ? `<span>${formatDate(p.startAt)}</span>` : ''}
            <span>${p.spotCount} pick${p.spotCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      `
      new maplibregl.Popup({ offset: 12 }).setLngLat(coords).setHTML(html).addTo(map)
    })

    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'unclustered-spot', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'unclustered-spot', () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'cleanup-locations', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'cleanup-locations', () => { map.getCanvas().style.cursor = '' })

    map.on('load', () => { setMapReady(true) })

    mapRef.current = map

    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply basemap selection changes by swapping the MapLibre style.
  // setStyle wipes all sources/layers; the style.load + styledata listeners
  // re-add them. We also call setupOverlays explicitly on the next 'idle'
  // tick as a belt-and-braces fallback (some MapLibre 4.x edge cases drop
  // 'style.load' for repeat setStyle calls).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (activeBasemapIdRef.current === selectedBasemapId) return
    const basemap = getBasemapById(selectedBasemapId)
    if (!basemap) return
    activeBasemapIdRef.current = selectedBasemapId
    map.setStyle(buildStyle(basemap))
    map.once('idle', () => { setupOverlaysRef.current?.() })
  }, [selectedBasemapId, mapReady])

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
      const source = map.getSource('spots-source') as maplibregl.GeoJSONSource | undefined
      if (source) source.setData(spotGeoJson)
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

  const hasData = (spotGeoJson?.features.length ?? 0) > 0 || (cleanupGeoJson?.features.length ?? 0) > 0

  return (
    <div className="map-page">
      <div className="map-container" ref={mapContainerRef} />
      <BasemapSwitcher />
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
