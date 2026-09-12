import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { ItemEditor, type DetectedItemData } from './ItemEditor'

import { API_BASE } from '../lib/apiBase'
import { requestErrorMessage, throwIfNotOk } from '../lib/apiFetch'

interface SpotEditorProps {
  spotId: string
  pickedUp: boolean
  items: DetectedItemData[]
  subjectKind?: 'litter' | 'plant'
  onSave: () => void
  onCancel: () => void
}

export function SpotEditor({ spotId, pickedUp, items, subjectKind = 'litter', onSave, onCancel }: SpotEditorProps) {
  const { t } = useTranslation(['spot', 'common'])
  const { sessionToken, guestId } = useAuthStore()
  const [currentPickedUp, setCurrentPickedUp] = useState(pickedUp)
  const [savingMeta, setSavingMeta] = useState(false)
  const [addingItem, setAddingItem] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setCurrentPickedUp(pickedUp)
  }, [pickedUp])

  const pickedUpChanged = currentPickedUp !== pickedUp

  const addItem = async () => {
    setAddingItem(true)
    setActionError(null)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    try {
      const res = await fetch(`${API_BASE}/spots/${spotId}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      })
      await throwIfNotOk(res)
      onSave()
    } catch (err) {
      setActionError(t('common:status.saveFailed', { reason: requestErrorMessage(err) }))
    } finally {
      setAddingItem(false)
    }
  }

  const saveMetadata = async () => {
    setSavingMeta(true)
    setActionError(null)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    const params = new URLSearchParams()
    if (!sessionToken && guestId) params.set('guestId', guestId)

    try {
      const res = await fetch(`${API_BASE}/spots/${spotId}?${params}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ pickedUp: currentPickedUp }),
      })
      await throwIfNotOk(res)
      onSave()
    } catch (err) {
      setActionError(t('common:status.saveFailed', { reason: requestErrorMessage(err) }))
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
          {t('editor.pickedUp')}
        </label>
        {pickedUpChanged && (
          <button className="secondary-button" onClick={saveMetadata} disabled={savingMeta}>
            {savingMeta ? t('common:actions.saving') : t('common:actions.save')}
          </button>
        )}
      </div>

      <div className="spot-editor-items">
        <h4 className="spot-editor-items-title">
          {subjectKind === 'plant' ? t('editor.identifiedPlant') : t('editor.detectedItems')}
        </h4>
        {items.map((item) => (
          <ItemEditor
            key={item.id}
            spotId={spotId}
            item={item}
            subjectKind={subjectKind}
            onUpdated={onSave}
            onRemoved={onSave}
          />
        ))}
        <button className="secondary-button spot-editor-add-item" onClick={addItem} disabled={addingItem}>
          {addingItem ? t('editor.adding') : t('editor.addItem')}
        </button>
      </div>
      {actionError && <p className="spot-location-error" role="alert">{actionError}</p>}

      <button className="secondary-button spot-editor-close" onClick={onCancel}>
        {t('common:actions.close')}
      </button>
    </div>
  )
}
