import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { ConfirmDialog } from './ConfirmDialog'

import { API_BASE } from '../lib/apiBase'

export interface LabelRef {
  id: string
  name: string
  scientificName?: string | null
}

export interface PlantInvasiveInfo {
  list: 'infoflora_black' | 'infoflora_watch'
  recommendedAction: string
}

export interface DetectedItemData {
  id: string
  objectLabel: LabelRef | null
  materialLabel: LabelRef | null
  brandLabel: LabelRef | null
  weightGrams: number | null
  confidence?: number | null
  plantInvasive?: PlantInvasiveInfo | null
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
  subjectKind,
  onChange,
}: {
  label: string
  type: string
  value: LabelRef | null
  subjectKind?: 'litter' | 'plant'
  onChange: (val: LabelRef | null) => void
}) {
  const { t } = useTranslation(['spot', 'common'])
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
    if (subjectKind) params.set('subjectKind', subjectKind)
    try {
      const res = await fetch(`${API_BASE}/labels?${params}`, { headers })
      if (res.ok) {
        const data = await res.json() as LabelSearchResult[]
        setResults(data)
        const exactMatch = data.some(r => r.name.toLowerCase() === q.toLowerCase())
        // Suppress "Add" for plant species — the create endpoint can't set scientific_name,
        // so a new label here wouldn't be findable from plant-subject autocomplete.
        const suppressAdd = subjectKind === 'plant' && type === 'object'
        setShowAddOption(!suppressAdd && !exactMatch && q.trim().length > 0)
      }
    } catch { /* ignore */ }
  }, [sessionToken, type, subjectKind])

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
          placeholder={t('item.search', { label: label.toLowerCase() })}
        />
        {value && (
          <button className="label-autocomplete-clear" onClick={clearValue} title={t('item.clear')}>&times;</button>
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
              {t('item.add', { name: query.trim() })}
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
  subjectKind,
  onUpdated,
  onRemoved,
}: {
  spotId: string
  item: DetectedItemData
  subjectKind?: 'litter' | 'plant'
  onUpdated: () => void
  onRemoved: () => void
}) {
  const { t } = useTranslation(['spot', 'common'])
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

  const invasiveListLabel = item.plantInvasive?.list === 'infoflora_black'
    ? t('item.blackList')
    : item.plantInvasive?.list === 'infoflora_watch' ? t('item.watchList') : null

  return (
    <div className="item-editor">
      <LabelAutocomplete
        label={subjectKind === 'plant' ? t('item.species') : t('item.object')}
        type="object"
        value={objectLabel}
        subjectKind={subjectKind}
        onChange={setObjectLabel}
      />
      {subjectKind !== 'plant' && (
        <>
          <LabelAutocomplete
            label={t('item.material')}
            type="material"
            value={materialLabel}
            onChange={setMaterialLabel}
          />
          <LabelAutocomplete label={t('item.brand')} type="brand" value={brandLabel} onChange={setBrandLabel} />
        </>
      )}
      {item.plantInvasive && (
        <div className={`plant-id-badge plant-id-badge--${item.plantInvasive.list === 'infoflora_black' ? 'black' : 'watch'}`}>
          {t('item.invasivePlant', { list: invasiveListLabel })}
          <p className="plant-id-action">{item.plantInvasive.recommendedAction}</p>
        </div>
      )}
      <div className="item-editor-weight">
        <label className="label-autocomplete-label">{t('item.weight')}</label>
        <input
          className="label-autocomplete-input"
          type="number"
          min="1"
          step="1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={t('item.weightPlaceholder')}
        />
      </div>
      {hasChanges && (
        <button className="secondary-button item-editor-save" onClick={saveItem} disabled={saving}>
          {saving ? t('common:actions.saving') : t('common:actions.save')}
        </button>
      )}
      <button
        className="item-editor-remove"
        title={t('item.removeTitle')}
        onClick={() => setConfirmingDelete(true)}
        disabled={removing}
      >
        {'\u{1F5D1}'}
      </button>
      {confirmingDelete && (
        <ConfirmDialog
          title={t('item.removeConfirmTitle')}
          actions={
            <>
              <button className="secondary-button" onClick={() => setConfirmingDelete(false)} disabled={removing}>
                {t('common:actions.cancel')}
              </button>
              <button className="danger-button" onClick={removeItem} disabled={removing}>
                {removing ? t('item.removing') : t('common:actions.remove')}
              </button>
            </>
          }
        >
          <p>{t('item.removeConfirmBody')}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
