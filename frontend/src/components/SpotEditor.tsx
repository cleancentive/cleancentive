import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { ItemEditor, type DetectedItemData } from './ItemEditor'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface SpotEditorProps {
  spotId: string
  pickedUp: boolean
  items: DetectedItemData[]
  onSave: () => void
  onCancel: () => void
}

export function SpotEditor({ spotId, pickedUp, items, onSave, onCancel }: SpotEditorProps) {
  const { sessionToken, guestId } = useAuthStore()
  const [currentPickedUp, setCurrentPickedUp] = useState(pickedUp)
  const [savingMeta, setSavingMeta] = useState(false)
  const [addingItem, setAddingItem] = useState(false)

  useEffect(() => {
    setCurrentPickedUp(pickedUp)
  }, [pickedUp])

  const pickedUpChanged = currentPickedUp !== pickedUp

  const addItem = async () => {
    setAddingItem(true)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    try {
      await fetch(`${API_BASE}/spots/${spotId}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      })
      onSave()
    } finally {
      setAddingItem(false)
    }
  }

  const saveMetadata = async () => {
    setSavingMeta(true)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    const params = new URLSearchParams()
    if (!sessionToken && guestId) params.set('guestId', guestId)

    try {
      await fetch(`${API_BASE}/spots/${spotId}?${params}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ pickedUp: currentPickedUp }),
      })
      onSave()
    } finally {
      setSavingMeta(false)
    }
  }

  return (
    <div className="spot-editor">
      <div className="spot-editor-section">
        <label className="spot-editor-toggle">
          <input
            type="checkbox"
            checked={currentPickedUp}
            onChange={(e) => setCurrentPickedUp(e.target.checked)}
          />
          Picked up
        </label>
        {pickedUpChanged && (
          <button className="secondary-button" onClick={saveMetadata} disabled={savingMeta}>
            {savingMeta ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      <div className="spot-editor-items">
        <h4 className="spot-editor-items-title">Detected Items</h4>
        {items.map((item) => (
          <ItemEditor key={item.id} spotId={spotId} item={item} onUpdated={onSave} onRemoved={onSave} />
        ))}
        <button className="secondary-button spot-editor-add-item" onClick={addItem} disabled={addingItem}>
          {addingItem ? 'Adding...' : '+ Add item'}
        </button>
      </div>

      <button className="secondary-button spot-editor-close" onClick={onCancel}>
        Close
      </button>
    </div>
  )
}
