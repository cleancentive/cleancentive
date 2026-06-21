import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getStandardBasemapSource } from '../config/basemaps'

interface ManualLocationDialogProps {
  initialLatitude: number | null
  initialLongitude: number | null
  onConfirm: (latitude: number, longitude: number) => void
  onCancel: () => void
}

export function ManualLocationDialog({
  initialLatitude,
  initialLongitude,
  onConfirm,
  onCancel,
}: ManualLocationDialogProps) {
  const { t } = useTranslation(['spot', 'common'])
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [picked, setPicked] = useState<{ latitude: number; longitude: number } | null>(
    initialLatitude !== null && initialLongitude !== null
      ? { latitude: initialLatitude, longitude: initialLongitude }
      : null,
  )

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const hasInitial = initialLatitude !== null && initialLongitude !== null
    const standard = getStandardBasemapSource()
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          standard: {
            type: 'raster',
            tiles: standard.tiles,
            tileSize: standard.tileSize ?? 256,
            attribution: standard.attribution,
            ...(standard.maxZoom ? { maxzoom: standard.maxZoom } : {}),
          },
        },
        layers: [{ id: 'standard', type: 'raster', source: 'standard' }],
      },
      center: hasInitial ? [initialLongitude!, initialLatitude!] : [0, 20],
      zoom: hasInitial ? 14 : 2,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    const marker = new maplibregl.Marker({ draggable: true })
    if (hasInitial) {
      marker.setLngLat([initialLongitude!, initialLatitude!]).addTo(map)
    }

    marker.on('dragend', () => {
      const pos = marker.getLngLat()
      setPicked({ latitude: pos.lat, longitude: pos.lng })
    })

    map.on('click', (e) => {
      marker.setLngLat([e.lngLat.lng, e.lngLat.lat]).addTo(map)
      setPicked({ latitude: e.lngLat.lat, longitude: e.lngLat.lng })
    })

    mapRef.current = map
    markerRef.current = marker

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="sign-in-overlay" onClick={onCancel}>
      <div className="sign-in-dialog manual-location-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="sign-in-close" onClick={onCancel} aria-label={t('common:actions.close')}>
          &times;
        </button>
        <h2>{t('manualLocation.title')}</h2>
        <p className="capture-detail">{t('manualLocation.hint')}</p>
        <div className="manual-location-map" ref={mapContainerRef} />
        <div className="manual-location-actions">
          <button className="secondary-button" onClick={onCancel}>
            {t('common:actions.cancel')}
          </button>
          <button
            className="primary-button"
            onClick={() => picked && onConfirm(picked.latitude, picked.longitude)}
            disabled={!picked}
          >
            {t('manualLocation.useThisLocation')}
          </button>
        </div>
      </div>
    </div>
  )
}
