import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { BackLink } from './BackLink'
import { formatCoord } from '@cleancentive/shared'
import { useAuthStore } from '../stores/authStore'
import { ItemEditor, type DetectedItemData } from './ItemEditor'
import { SpotEditHistory } from './SpotEditHistory'
import { SpotLocationDialog } from './SpotLocationDialog'
import { useCopyToClipboard } from '../lib/useCopyToClipboard'

import { API_BASE } from '../lib/apiBase'

interface SpotData {
  id: string
  status: string
  userId: string
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number | null
  pickedUp: boolean
  subjectKind: 'litter' | 'plant'
  items: DetectedItemData[]
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function SpotDetail() {
  const { t } = useTranslation(['spot', 'common'])
  const { id } = useParams<{ id: string }>()
  const { sessionToken, user } = useAuthStore()
  const [spot, setSpot] = useState<SpotData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historyTick, setHistoryTick] = useState(0)
  const [addingItem, setAddingItem] = useState(false)
  const [editingLocation, setEditingLocation] = useState(false)
  const { copied: locationCopied, copy: copyLocation } = useCopyToClipboard()

  const loadSpot = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/spots/${id}/view`)
      if (!res.ok) {
        if (res.status === 404) throw new Error(t('detail.notFound'))
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json() as SpotData
      setSpot(data)
    } catch (err: any) {
      setError(err.message)
    }
  }, [id, t])

  useEffect(() => { loadSpot() }, [loadSpot])

  const onItemChanged = useCallback(() => {
    loadSpot()
    setHistoryTick((t) => t + 1)
  }, [loadSpot])

  const addItem = async () => {
    if (!id) return
    setAddingItem(true)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`
    try {
      await fetch(`${API_BASE}/spots/${id}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      })
      onItemChanged()
    } finally {
      setAddingItem(false)
    }
  }

  if (error) {
    return (
      <div className="spot-detail">
        <BackLink to="/map" fallbackNoun="map" />
        <p className="spot-detail-error">{error}</p>
      </div>
    )
  }

  if (!spot) {
    return (
      <div className="spot-detail">
        <BackLink to="/map" fallbackNoun="map" />
        <p>{t('common:actions.loading')}</p>
      </div>
    )
  }

  const isOwner = !!user && user.id === spot.userId

  return (
    <div className="spot-detail">
      <BackLink to="/map" fallbackNoun="map" />

      <div className="spot-detail-header">
        <img
          className="spot-detail-image"
          src={`${API_BASE}/spots/${spot.id}/thumbnail`}
          alt={t('detail.alt')}
        />
        <div className="spot-detail-meta">
          <p className="history-timestamp">
            {formatDateTime(spot.capturedAt)}
            {!spot.pickedUp && <span className="history-spotted-badge">{t('detail.spotted')}</span>}
          </p>
          <p className="history-meta">
            {t('detail.metaAccuracy', {
              lat: formatCoord(spot.latitude),
              lng: formatCoord(spot.longitude),
              accuracy: spot.accuracyMeters !== null ? `±${Math.round(spot.accuracyMeters)}m` : t('detail.accuracyUnknown'),
            })}
          </p>
          <div className="spot-location-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => copyLocation(`${formatCoord(spot.latitude, 6)},${formatCoord(spot.longitude, 6)}`)}
            >
              {locationCopied ? t('detail.copied') : t('detail.copyLocation')}
            </button>
            {isOwner && (
              <button type="button" className="secondary-button" onClick={() => setEditingLocation(true)}>
                {t('detail.editLocation')}
              </button>
            )}
          </div>
        </div>
      </div>

      {editingLocation && (
        <SpotLocationDialog
          spotId={spot.id}
          initialLatitude={spot.latitude}
          initialLongitude={spot.longitude}
          initialAccuracyMeters={spot.accuracyMeters}
          onSaved={() => {
            setEditingLocation(false)
            loadSpot()
            setHistoryTick((t) => t + 1)
          }}
          onCancel={() => setEditingLocation(false)}
        />
      )}

      <section className="spot-detail-items">
        <h3>{spot.subjectKind === 'plant' ? t('detail.identifiedPlant') : t('detail.detectedItems')}</h3>
        {!sessionToken && (
          <p className="spot-detail-readonly-hint">
            {spot.subjectKind === 'plant' ? t('detail.signInToEditPlant') : t('detail.signInToEditItems')}
          </p>
        )}
        {spot.items.length === 0 && spot.status !== 'completed' && spot.status !== 'failed' && (
          <p className="history-meta">
            {spot.subjectKind === 'plant' ? t('detail.identifyingPlant') : t('detail.detectingItems')}
          </p>
        )}
        {spot.items.length === 0 && spot.status === 'completed' && (
          <p className="history-meta">
            {spot.subjectKind === 'plant'
              ? t('detail.plantNotConfident')
              : t('detail.noItemsYet')}
          </p>
        )}
        {spot.items.length === 0 && spot.status === 'failed' && (
          <p className="error-message">
            {spot.subjectKind === 'plant' ? t('detail.identificationFailed') : t('detail.detectionFailed')} {t('detail.failedRetryHint')}
          </p>
        )}
        {sessionToken ? (
          <>
            {spot.items.map((item) => (
              <ItemEditor
                key={item.id}
                spotId={spot.id}
                item={item}
                subjectKind={spot.subjectKind}
                onUpdated={onItemChanged}
                onRemoved={onItemChanged}
              />
            ))}
            <button
              className="secondary-button spot-editor-add-item"
              onClick={addItem}
              disabled={addingItem}
            >
              {addingItem ? t('detail.adding') : t('detail.addItem')}
            </button>
          </>
        ) : (
          <ul className="history-items">
            {spot.items.map((item) => (
              <li key={item.id} className="history-item-row">
                <span>
                  {item.objectLabel?.name ?? '—'}
                  {item.objectLabel?.scientificName && (
                    <em className="plant-id-scientific"> · {item.objectLabel.scientificName}</em>
                  )}
                  {item.materialLabel ? ` · ${item.materialLabel.name}` : ''}
                  {item.brandLabel ? ` · ${item.brandLabel.name}` : ''}
                </span>
                <span>{item.weightGrams !== null ? `${Math.round(item.weightGrams)} g` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="spot-detail-history">
        <button
          className="secondary-button"
          onClick={() => setShowHistory((v) => !v)}
        >
          {showHistory ? t('detail.hideHistory') : t('detail.viewHistory')}
        </button>
        {showHistory && <SpotEditHistory key={historyTick} spotId={spot.id} />}
      </section>
    </div>
  )
}
