import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { ItemEditor, type DetectedItemData } from './ItemEditor'
import { SpotEditHistory } from './SpotEditHistory'

import { API_BASE } from '../lib/apiBase'

interface SpotData {
  id: string
  status: string
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number | null
  pickedUp: boolean
  items: DetectedItemData[]
}

function formatCoord(n: number): string {
  return n.toFixed(5)
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function SpotDetail() {
  const { id } = useParams<{ id: string }>()
  const { sessionToken } = useAuthStore()
  const [spot, setSpot] = useState<SpotData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historyTick, setHistoryTick] = useState(0)
  const [addingItem, setAddingItem] = useState(false)

  const loadSpot = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/spots/${id}/view`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('Spot not found')
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json() as SpotData
      setSpot(data)
    } catch (err: any) {
      setError(err.message)
    }
  }, [id])

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
        <Link to="/map" className="back-link">&larr; Back to map</Link>
        <p className="spot-detail-error">{error}</p>
      </div>
    )
  }

  if (!spot) {
    return (
      <div className="spot-detail">
        <Link to="/map" className="back-link">&larr; Back to map</Link>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="spot-detail">
      <Link to="/map" className="back-link">&larr; Back to map</Link>

      <div className="spot-detail-header">
        <img
          className="spot-detail-image"
          src={`${API_BASE}/spots/${spot.id}/thumbnail`}
          alt="Spot"
        />
        <div className="spot-detail-meta">
          <p className="history-timestamp">
            {formatDateTime(spot.capturedAt)}
            {!spot.pickedUp && <span className="history-spotted-badge">Spotted</span>}
          </p>
          <p className="history-meta">
            {formatCoord(spot.latitude)}, {formatCoord(spot.longitude)} | accuracy {spot.accuracyMeters !== null ? `±${Math.round(spot.accuracyMeters)}m` : 'unknown'}
          </p>
        </div>
      </div>

      <section className="spot-detail-items">
        <h3>Detected items</h3>
        {!sessionToken && (
          <p className="spot-detail-readonly-hint">Sign in to edit detected items.</p>
        )}
        {spot.items.length === 0 && sessionToken && (
          <p className="history-meta">No items recorded yet.</p>
        )}
        {sessionToken ? (
          <>
            {spot.items.map((item) => (
              <ItemEditor
                key={item.id}
                spotId={spot.id}
                item={item}
                onUpdated={onItemChanged}
                onRemoved={onItemChanged}
              />
            ))}
            <button
              className="secondary-button spot-editor-add-item"
              onClick={addItem}
              disabled={addingItem}
            >
              {addingItem ? 'Adding...' : '+ Add item'}
            </button>
          </>
        ) : (
          <ul className="history-items">
            {spot.items.map((item) => (
              <li key={item.id} className="history-item-row">
                <span>
                  {item.objectLabel?.name ?? '—'}
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
          {showHistory ? 'Hide edit history' : 'View edit history'}
        </button>
        {showHistory && <SpotEditHistory key={historyTick} spotId={spot.id} />}
      </section>
    </div>
  )
}
