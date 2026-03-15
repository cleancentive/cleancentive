import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

interface LocationPickerProps {
  latitude: string
  longitude: string
  locationName: string
  onLatitudeChange: (v: string) => void
  onLongitudeChange: (v: string) => void
  onLocationNameChange: (v: string) => void
}

interface NominatimResult {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const NOMINATIM_HEADERS = { 'User-Agent': 'cleancentive' }

async function searchNominatim(query: string): Promise<NominatimResult[]> {
  const params = new URLSearchParams({ format: 'json', q: query, limit: '5' })
  const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, { headers: NOMINATIM_HEADERS })
  return res.json()
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const params = new URLSearchParams({ format: 'json', lat: String(lat), lon: String(lon) })
  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, { headers: NOMINATIM_HEADERS })
  const data = await res.json()
  if (!data || data.error) return null
  const addr = data.address
  if (!addr) return data.display_name || null
  // Build a short name: place/village/city + country
  const place = addr.tourism || addr.amenity || addr.leisure || addr.building || addr.road || ''
  const locality = addr.village || addr.town || addr.city || addr.municipality || ''
  const parts = [place, locality].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : data.display_name || null
}

export function LocationPicker({
  latitude,
  longitude,
  locationName,
  onLatitudeChange,
  onLongitudeChange,
  onLocationNameChange,
}: LocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [locatingGps, setLocatingGps] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reverseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lat = parseFloat(latitude)
  const lon = parseFloat(longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon)

  // Update marker + map when coords change externally
  const syncMarker = useCallback((newLat: number, newLon: number, fly = true) => {
    if (!markerRef.current || !mapRef.current) return
    markerRef.current.setLngLat([newLon, newLat])
    if (fly) {
      mapRef.current.flyTo({ center: [newLon, newLat], zoom: Math.max(mapRef.current.getZoom(), 13) })
    }
  }, [])

  // Reverse geocode only if locationName is empty
  const maybeReverseGeocode = useCallback((newLat: number, newLon: number) => {
    if (locationName) return
    if (reverseDebounceRef.current) clearTimeout(reverseDebounceRef.current)
    reverseDebounceRef.current = setTimeout(async () => {
      const name = await reverseGeocode(newLat, newLon)
      if (name) onLocationNameChange(name)
    }, 500)
  }, [locationName, onLocationNameChange])

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const initialCenter: [number, number] = hasCoords ? [lon, lat] : [0, 20]
    const initialZoom = hasCoords ? 13 : 2

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
      center: initialCenter,
      zoom: initialZoom,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    const marker = new maplibregl.Marker({ draggable: true })
    if (hasCoords) {
      marker.setLngLat([lon, lat]).addTo(map)
    }

    marker.on('dragend', () => {
      const pos = marker.getLngLat()
      onLatitudeChange(pos.lat.toFixed(6))
      onLongitudeChange(pos.lng.toFixed(6))
      maybeReverseGeocode(pos.lat, pos.lng)
    })

    map.on('click', (e) => {
      const { lng, lat: clickLat } = e.lngLat
      marker.setLngLat([lng, clickLat]).addTo(map)
      onLatitudeChange(clickLat.toFixed(6))
      onLongitudeChange(lng.toFixed(6))
      maybeReverseGeocode(clickLat, lng)
    })

    mapRef.current = map
    markerRef.current = marker

    // If no coords provided, center on user's GPS location
    if (!hasCoords && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (mapRef.current) {
            mapRef.current.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 13 })
          }
        },
        () => { /* silent fail */ },
        { enableHighAccuracy: false, timeout: 5000 },
      )
    }

    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync marker when coords change (manual input, suggestion, or external)
  useEffect(() => {
    if (!hasCoords || !mapRef.current || !markerRef.current) return
    markerRef.current.setLngLat([lon, lat]).addTo(mapRef.current)
    mapRef.current.flyTo({ center: [lon, lat], zoom: Math.max(mapRef.current.getZoom(), 13) })
  }, [lat, lon, hasCoords])

  // Debounced search
  const handleSearchInput = (value: string) => {
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchNominatim(value.trim())
        setSuggestions(results)
        setShowSuggestions(results.length > 0)
        setActiveIndex(-1)
      } catch {
        setSuggestions([])
      }
    }, 300)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((prev) => (prev + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      selectSuggestion(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setActiveIndex(-1)
    }
  }

  const selectSuggestion = (result: NominatimResult) => {
    const newLat = parseFloat(result.lat)
    const newLon = parseFloat(result.lon)
    onLatitudeChange(newLat.toFixed(6))
    onLongitudeChange(newLon.toFixed(6))
    // Extract a short name from display_name (first 1-2 parts)
    const shortName = result.display_name.split(',').slice(0, 2).join(',').trim()
    onLocationNameChange(shortName)
    setSearchQuery('')
    setSuggestions([])
    setShowSuggestions(false)
    syncMarker(newLat, newLon)
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    setLocatingGps(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newLat = pos.coords.latitude
        const newLon = pos.coords.longitude
        onLatitudeChange(newLat.toFixed(6))
        onLongitudeChange(newLon.toFixed(6))
        syncMarker(newLat, newLon)
        maybeReverseGeocode(newLat, newLon)
        setLocatingGps(false)
      },
      () => { setLocatingGps(false) },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="location-picker">
      <div className="location-search-wrapper">
        <input
          type="text"
          className="search-input"
          placeholder="Search for a place..."
          value={searchQuery}
          onChange={(e) => handleSearchInput(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
        />
        <button type="button" className="location-use-gps" onClick={useMyLocation} disabled={locatingGps} title="Use my location">
          {locatingGps ? '...' : '📍'}
        </button>
        {showSuggestions && (
          <ul className="location-suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.place_id}
                role="option"
                aria-selected={i === activeIndex}
                className={i === activeIndex ? 'location-suggestion--active' : ''}
                onMouseDown={() => selectSuggestion(s)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                {s.display_name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="location-map" ref={mapContainerRef} />

      <div className="location-coords">
        <div className="form-group">
          <label>Location name</label>
          <input
            type="text"
            value={locationName}
            onChange={(e) => onLocationNameChange(e.target.value)}
            placeholder="e.g. Central Park"
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Lat</label>
            <input type="number" step="any" value={latitude} onChange={(e) => onLatitudeChange(e.target.value)} placeholder="40.785" required />
          </div>
          <div className="form-group">
            <label>Lon</label>
            <input type="number" step="any" value={longitude} onChange={(e) => onLongitudeChange(e.target.value)} placeholder="-73.968" required />
          </div>
        </div>
      </div>
    </div>
  )
}
