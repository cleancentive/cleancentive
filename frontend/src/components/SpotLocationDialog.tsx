import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCoord } from '@cleancentive/shared'
import { useAuthStore } from '../stores/authStore'
import { useCopyToClipboard } from '../lib/useCopyToClipboard'
import { LocationPicker } from './LocationPicker'
import { API_BASE } from '../lib/apiBase'

interface SpotLocationDialogProps {
  spotId: string
  initialLatitude: number
  initialLongitude: number
  initialAccuracyMeters: number | null
  onSaved: () => void
  onCancel: () => void
}

export function SpotLocationDialog({
  spotId,
  initialLatitude,
  initialLongitude,
  initialAccuracyMeters,
  onSaved,
  onCancel,
}: SpotLocationDialogProps) {
  const { t } = useTranslation(['spot', 'common'])
  const { sessionToken, guestId } = useAuthStore()
  const [latitude, setLatitude] = useState(String(initialLatitude))
  const [longitude, setLongitude] = useState(String(initialLongitude))
  const [pastedAccuracy, setPastedAccuracy] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { copied, copy } = useCopyToClipboard()

  const latNum = parseFloat(latitude)
  const lngNum = parseFloat(longitude)
  const coordsValid = Number.isFinite(latNum) && Number.isFinite(lngNum)
  const dirty = coordsValid && (latNum !== initialLatitude || lngNum !== initialLongitude)

  const handleCopy = () => {
    if (!coordsValid) return
    copy(`${formatCoord(latNum, 6)},${formatCoord(lngNum, 6)}`)
  }

  const handleSave = async () => {
    if (!coordsValid) return
    setSaving(true)
    setSaveError(null)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`
    const params = new URLSearchParams()
    if (!sessionToken && guestId) params.set('guestId', guestId)
    try {
      const res = await fetch(`${API_BASE}/spots/${spotId}?${params}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          latitude: latNum,
          longitude: lngNum,
          accuracyMeters: pastedAccuracy,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message || `HTTP ${res.status}`)
      }
      onSaved()
    } catch (err: any) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sign-in-overlay" onClick={onCancel}>
      <div className="sign-in-dialog spot-location-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="sign-in-close" onClick={onCancel} aria-label={t('common:actions.close')}>
          &times;
        </button>
        <h2>{t('locationDialog.title')}</h2>

        <LocationPicker
          hideLocationName
          latitude={latitude}
          longitude={longitude}
          locationName=""
          onLatitudeChange={setLatitude}
          onLongitudeChange={setLongitude}
          onLocationNameChange={() => {}}
          onCoordsPasted={(acc) => setPastedAccuracy(acc)}
        />

        <div className="spot-location-clipboard">
          <button type="button" className="secondary-button" onClick={handleCopy} disabled={!coordsValid}>
            {copied ? t('locationDialog.copied') : t('locationDialog.copyLocation')}
          </button>
          {initialAccuracyMeters !== null && (
            <span className="spot-location-hint">{t('locationDialog.originalAccuracy', { meters: Math.round(initialAccuracyMeters) })}</span>
          )}
        </div>
        {saveError && <p className="spot-location-error">{saveError}</p>}

        <div className="manual-location-actions">
          <button className="secondary-button" onClick={onCancel}>
            {t('common:actions.cancel')}
          </button>
          <button
            className="primary-button"
            onClick={handleSave}
            disabled={!dirty || saving || !coordsValid}
          >
            {saving ? t('common:actions.saving') : t('common:actions.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
