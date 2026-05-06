import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { ConfirmDialog } from './ConfirmDialog'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export interface LabelRef {
  id: string
  name: string
}

export interface DetectedItemData {
  id: string
  objectLabel: LabelRef | null
  materialLabel: LabelRef | null
  brandLabel: LabelRef | null
  weightGrams: number | null
}

interface LabelSearchResult {
  id: string
  name: string
  type: string
}

export function LabelAutocomplete({
  label,
  type,
  value,
  onChange,
}: {
  label: string
  type: string
  value: LabelRef | null
  onChange: (val: LabelRef | null) => void
}) {
  const { sessionToken } = useAuthStore()
  const [query, setQuery] = useState(value?.name ?? '')
  const [results, setResults] = useState<LabelSearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [showAddOption, setShowAddOption] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([])
      setShowAddOption(false)
      return
    }

    const headers: Record<string, string> = {}
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    const params = new URLSearchParams({ type, search: q, limit: '10' })
    try {
      const res = await fetch(`${API_BASE}/labels?${params}`, { headers })
      if (res.ok) {
        const data = await res.json() as LabelSearchResult[]
        setResults(data)
        const exactMatch = data.some(r => r.name.toLowerCase() === q.toLowerCase())
        setShowAddOption(!exactMatch && q.trim().length > 0)
      }
    } catch { /* ignore */ }
  }, [sessionToken, type])

  const handleInput = (text: string) => {
    setQuery(text)
    setIsOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(text), 300)
  }

  const selectLabel = (item: LabelSearchResult) => {
    onChange({ id: item.id, name: item.name })
    setQuery(item.name)
    setIsOpen(false)
  }

  const createAndSelect = async (name: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    try {
      const res = await fetch(`${API_BASE}/labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type, translations: { en: name.trim() } }),
      })
      if (res.ok) {
        const created = await res.json() as LabelSearchResult
        onChange({ id: created.id, name: created.name })
        setQuery(created.name)
        setIsOpen(false)
      }
    } catch { /* ignore */ }
  }

  const clearValue = () => {
    onChange(null)
    setQuery('')
    setResults([])
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  return (
    <div className="label-autocomplete" ref={wrapperRef}>
      <label className="label-autocomplete-label">{label}</label>
      <div className="label-autocomplete-input-wrap">
        <input
          className="label-autocomplete-input"
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (query) setIsOpen(true) }}
          placeholder={`Search ${label.toLowerCase()}...`}
        />
        {value && (
          <button className="label-autocomplete-clear" onClick={clearValue} title="Clear">&times;</button>
        )}
      </div>
      {isOpen && (results.length > 0 || showAddOption) && (
        <ul className="label-autocomplete-dropdown">
          {results.map((r) => (
            <li key={r.id} className="label-autocomplete-option" onClick={() => selectLabel(r)}>
              {r.name}
            </li>
          ))}
          {showAddOption && (
            <li
              className="label-autocomplete-option label-autocomplete-add"
              onClick={() => createAndSelect(query)}
            >
              Add: {query.trim()}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

export function ItemEditor({
  spotId,
  item,
  onUpdated,
  onRemoved,
}: {
  spotId: string
  item: DetectedItemData
  onUpdated: () => void
  onRemoved: () => void
}) {
  const { sessionToken } = useAuthStore()
  const [objectLabel, setObjectLabel] = useState<LabelRef | null>(item.objectLabel)
  const [materialLabel, setMaterialLabel] = useState<LabelRef | null>(item.materialLabel)
  const [brandLabel, setBrandLabel] = useState<LabelRef | null>(item.brandLabel)
  const [weight, setWeight] = useState(item.weightGrams !== null ? String(item.weightGrams) : '')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    setObjectLabel(item.objectLabel)
    setMaterialLabel(item.materialLabel)
    setBrandLabel(item.brandLabel)
    setWeight(item.weightGrams !== null ? String(item.weightGrams) : '')
  }, [item.objectLabel?.id, item.materialLabel?.id, item.brandLabel?.id, item.weightGrams])

  const hasChanges =
    objectLabel?.id !== item.objectLabel?.id ||
    materialLabel?.id !== item.materialLabel?.id ||
    brandLabel?.id !== item.brandLabel?.id ||
    (weight === '' ? null : parseFloat(weight)) !== item.weightGrams

  const saveItem = async () => {
    setSaving(true)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    const body: Record<string, unknown> = {}
    if (objectLabel?.id !== item.objectLabel?.id) body.objectLabelId = objectLabel?.id ?? null
    if (materialLabel?.id !== item.materialLabel?.id) body.materialLabelId = materialLabel?.id ?? null
    if (brandLabel?.id !== item.brandLabel?.id) body.brandLabelId = brandLabel?.id ?? null

    const newWeight = weight === '' ? null : parseFloat(weight)
    if (newWeight !== item.weightGrams) body.weightGrams = newWeight

    try {
      await fetch(`${API_BASE}/spots/${spotId}/items/${item.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async () => {
    setRemoving(true)
    const headers: Record<string, string> = {}
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    try {
      await fetch(`${API_BASE}/spots/${spotId}/items/${item.id}`, {
        method: 'DELETE',
        headers,
      })
      setConfirmingDelete(false)
      onRemoved()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="item-editor">
      <LabelAutocomplete label="Object" type="object" value={objectLabel} onChange={setObjectLabel} />
      <LabelAutocomplete label="Material" type="material" value={materialLabel} onChange={setMaterialLabel} />
      <LabelAutocomplete label="Brand" type="brand" value={brandLabel} onChange={setBrandLabel} />
      <div className="item-editor-weight">
        <label className="label-autocomplete-label">Weight (g)</label>
        <input
          className="label-autocomplete-input"
          type="number"
          min="0"
          step="1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="grams"
        />
      </div>
      {hasChanges && (
        <button className="secondary-button item-editor-save" onClick={saveItem} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      )}
      <button
        className="item-editor-remove"
        title="Remove item"
        onClick={() => setConfirmingDelete(true)}
        disabled={removing}
      >
        {'\u{1F5D1}'}
      </button>
      {confirmingDelete && (
        <ConfirmDialog
          title="Remove this item?"
          actions={
            <>
              <button className="secondary-button" onClick={() => setConfirmingDelete(false)} disabled={removing}>
                Cancel
              </button>
              <button className="danger-button" onClick={removeItem} disabled={removing}>
                {removing ? 'Removing...' : 'Remove'}
              </button>
            </>
          }
        >
          <p>The item will be removed from this spot. An entry is kept in the edit history so this action can be reviewed and, if needed, restored later.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
