import { useEffect, useRef, useCallback, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStore } from '../stores/mapStore'
import { useAuthStore } from '../stores/authStore'
import { useInsightsFilterStore, presetToSince, pickedUpFilterToParam } from '../stores/insightsFilterStore'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function MapPage() {
  const { spotGeoJson, cleanupGeoJson, isLoading, error, fetchMapData } = useMapStore()
  const { user } = useAuthStore()
  const { datePreset, pickedUpFilter } = useInsightsFilterStore()

  const teamId = user?.active_team_id ?? undefined
  const cleanupDateId = user?.active_cleanup_date_id ?? undefined

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const userInteractedRef = useRef(false)
  const hasFittedRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    fetchMapData({
      team_id: teamId,
      cleanup_date_id: cleanupDateId,
      since: presetToSince(datePreset),
      picked_up: pickedUpFilterToParam(pickedUpFilter),
    })
  }, [fetchMapData, teamId, cleanupDateId, datePreset, pickedUpFilter])

  // Reset userInteracted when filters change so auto-fit fires again
  useEffect(() => {
    userInteractedRef.current = false
  }, [teamId, cleanupDateId, datePreset, pickedUpFilter])

  // Initialize map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [0, 20],
      zoom: 2,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('mousedown', () => { userInteractedRef.current = true })
    map.on('wheel', () => { userInteractedRef.current = true })
    map.on('touchstart', () => { userInteractedRef.current = true })

    map.on('load', () => {
      // Spots source with clustering
      map.addSource('spots-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      })

      // Cluster circles
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'spots-source',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#51bbd6', 10,
            '#f1f075', 50,
            '#f28cb1',
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

      // Cluster count labels
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

      // Individual spot circles
      map.addLayer({
        id: 'unclustered-spot',
        type: 'circle',
        source: 'spots-source',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'case',
            ['==', ['get', 'pickedUp'], false],
            '#2563eb', // blue for spot-only
            [
              'match', ['get', 'status'],
              'completed', '#4caf50',
              'processing', '#ff9800',
              'failed', '#f44336',
              '#9e9e9e',
            ],
          ],
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      })

      // Cleanup locations source (no clustering)
      map.addSource('cleanups-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'cleanup-locations',
        type: 'circle',
        source: 'cleanups-source',
        paint: {
          'circle-color': '#1976d2',
          'circle-radius': 10,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#fff',
        },
      })

      // Click: zoom into cluster
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

      // Click: spot popup
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
              <strong>${p.topCategory ? p.topCategory.replace(/_/g, ' ') : (p.pickedUp === false ? 'Spot' : 'Pick')}</strong>
              <span>${formatDate(p.capturedAt)}</span>
              <span>${p.itemCount} item${p.itemCount !== 1 ? 's' : ''} detected</span>
            </div>
          </div>
        `
        new maplibregl.Popup({ offset: 10 }).setLngLat(coords).setHTML(html).addTo(map)
      })

      // Click: cleanup popup
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

      // Cursors
      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = '' })
      map.on('mouseenter', 'unclustered-spot', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'unclustered-spot', () => { map.getCanvas().style.cursor = '' })
      map.on('mouseenter', 'cleanup-locations', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'cleanup-locations', () => { map.getCanvas().style.cursor = '' })

      setMapReady(true)
    })

    mapRef.current = map

    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
