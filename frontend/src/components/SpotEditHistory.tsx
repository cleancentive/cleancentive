import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

import { API_BASE } from '../lib/apiBase'

interface EditEntry {
  id: string
  entityType: 'item' | 'spot'
  detectedItemId: string | null
  fieldChanged: string
  oldValue: string | null
  newValue: string | null
  createdBy: string
  createdByName: string | null
  createdAt: string
}

const FIELD_LABEL_KEYS: Record<string, string> = {
  object_label_id: 'history.fields.object',
  material_label_id: 'history.fields.material',
  brand_label_id: 'history.fields.brand',
  weight_grams: 'history.fields.weight',
  deleted: 'history.fields.itemRemoved',
  latitude: 'history.fields.latitude',
  longitude: 'history.fields.longitude',
  location_accuracy_meters: 'history.fields.accuracy',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString()
}

function describeChange(entry: EditEntry, t: TFunction): string {
  if (entry.fieldChanged === 'deleted') {
    return t('history.fields.itemRemoved')
  }
  const labelKey = FIELD_LABEL_KEYS[entry.fieldChanged]
  const field = labelKey ? t(labelKey) : entry.fieldChanged
  const prefix = entry.entityType === 'spot' ? t('history.locationPrefix') : ''
  if (entry.oldValue === null) return t('history.fieldSet', { prefix, field })
  if (entry.newValue === null) return t('history.fieldCleared', { prefix, field })
  return t('history.fieldChanged', { prefix, field })
}

export function SpotEditHistory({ spotId }: { spotId: string }) {
  const { t } = useTranslation(['spot', 'common'])
  const [entries, setEntries] = useState<EditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setError(null)
    fetch(`${API_BASE}/spots/${spotId}/edit-history`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ entries: EditEntry[] }>
      })
      .then((data) => { if (!cancelled) setEntries(data.entries) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [spotId])

  if (error) return <p className="spot-edit-history-error">{t('history.loadFailed', { message: error })}</p>
  if (!entries) return <p className="spot-edit-history-loading">{t('history.loading')}</p>
  if (entries.length === 0) return <p className="spot-edit-history-empty">{t('history.empty')}</p>

  return (
    <ul className="spot-edit-history">
      {entries.map((entry) => (
        <li key={entry.id} className="spot-edit-history-row">
          <span className="spot-edit-history-when">{formatDateTime(entry.createdAt)}</span>
          <span className="spot-edit-history-who">{entry.createdByName ?? entry.createdBy.slice(0, 8)}</span>
          <span className="spot-edit-history-what">{describeChange(entry, t)}</span>
        </li>
      ))}
    </ul>
  )
}
