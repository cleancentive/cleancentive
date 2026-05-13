import { useEffect, useState } from 'react'

import { API_BASE } from '../lib/apiBase'

interface EditEntry {
  id: string
  detectedItemId: string | null
  fieldChanged: string
  oldValue: string | null
  newValue: string | null
  createdBy: string
  createdByName: string | null
  createdAt: string
}

const FIELD_LABELS: Record<string, string> = {
  object_label_id: 'Object',
  material_label_id: 'Material',
  brand_label_id: 'Brand',
  weight_grams: 'Weight (g)',
  deleted: 'Item removed',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString()
}

function describeChange(entry: EditEntry): string {
  if (entry.fieldChanged === 'deleted') {
    return 'Item removed'
  }
  const fieldLabel = FIELD_LABELS[entry.fieldChanged] ?? entry.fieldChanged
  if (entry.oldValue === null) return `${fieldLabel} set`
  if (entry.newValue === null) return `${fieldLabel} cleared`
  return `${fieldLabel} changed`
}

export function SpotEditHistory({ spotId }: { spotId: string }) {
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

  if (error) return <p className="spot-edit-history-error">Failed to load history: {error}</p>
  if (!entries) return <p className="spot-edit-history-loading">Loading edit history...</p>
  if (entries.length === 0) return <p className="spot-edit-history-empty">No edits yet.</p>

  return (
    <ul className="spot-edit-history">
      {entries.map((entry) => (
        <li key={entry.id} className="spot-edit-history-row">
          <span className="spot-edit-history-when">{formatDateTime(entry.createdAt)}</span>
          <span className="spot-edit-history-who">{entry.createdByName ?? entry.createdBy.slice(0, 8)}</span>
          <span className="spot-edit-history-what">{describeChange(entry)}</span>
        </li>
      ))}
    </ul>
  )
}
