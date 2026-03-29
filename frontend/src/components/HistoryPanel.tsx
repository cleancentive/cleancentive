import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useUiStore } from '../stores/uiStore'
import { useInsightsFilterStore, presetToSince, pickedUpFilterToParam } from '../stores/insightsFilterStore'
import { flushOutbox, getOutboxItems, type OutboxItem } from '../lib/pendingPicks'
import { formatTimestamp } from '../utils/formatTimestamp'
import { CountdownButton } from './CountdownButton'
import { SpotEditor } from './SpotEditor'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface HistoryItem {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | string
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number
  pickedUp: boolean
  processingError: string | null
  detectionCompletedAt: string | null
  items: {
    id: string
    objectLabel: { id: string; name: string } | null
    materialLabel: { id: string; name: string } | null
    brandLabel: { id: string; name: string } | null
    weightGrams: number | null
    confidence: number | null
  }[]
}

type Row =
  | { kind: 'local'; item: OutboxItem }
  | { kind: 'server'; item: HistoryItem }

type StageStatus = 'not-reached' | 'in-progress' | 'success' | 'failed'

interface StageState {
  label: string
  status: StageStatus
}

function mapRowToStages(row: Row): { stages: [StageState, StageState, StageState]; errorMessage: string | null } {
  if (row.kind === 'local') {
    const s = row.item.status
    return {
      stages: [
        { label: 'Local', status: s === 'failed' ? 'failed' : 'in-progress' },
        { label: 'Synced', status: 'not-reached' },
        { label: 'Detected', status: 'not-reached' },
      ],
      errorMessage: s === 'failed' ? row.item.lastError : null,
    }
  }

  const s = row.item.status
  if (s === 'completed') {
    return {
      stages: [
        { label: 'Local', status: 'success' },
        { label: 'Synced', status: 'success' },
        { label: 'Detected', status: 'success' },
      ],
      errorMessage: null,
    }
  }
  if (s === 'failed') {
    return {
      stages: [
        { label: 'Local', status: 'success' },
        { label: 'Synced', status: 'success' },
        { label: 'Detected', status: 'failed' },
      ],
      errorMessage: row.item.processingError,
    }
  }
  // queued or processing
  return {
    stages: [
      { label: 'Local', status: 'success' },
      { label: 'Synced', status: 'success' },
      { label: 'Detected', status: 'in-progress' },
    ],
    errorMessage: null,
  }
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2.5 6.5 5 9 9.5 3.5" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="lifecycle-stepper-spin" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6 1a5 5 0 0 1 5 5" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  )
}

function DotIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="2.5" fill="currentColor" />
    </svg>
  )
}

function stageIcon(status: StageStatus) {
  if (status === 'success') return <CheckIcon />
  if (status === 'in-progress') return <SpinnerIcon />
  if (status === 'failed') return <ErrorIcon />
  return <DotIcon />
}

function LifecycleStepper({ stages, errorMessage, onRetry }: {
  stages: [StageState, StageState, StageState]
  errorMessage: string | null
  onRetry: (() => void) | null
}) {
  return (
    <div className="lifecycle-stepper">
      <div className="lifecycle-stepper-row">
        {stages.map((stage, i) => (
          <div key={stage.label} className="lifecycle-stepper-segment">
            {i > 0 && (
              <div className={`lifecycle-stepper-line${stage.status !== 'not-reached' ? ' lifecycle-stepper-line--done' : ''}`} />
            )}
            <div className="lifecycle-stepper-stage">
              <div className={`lifecycle-stepper-circle lifecycle-stepper-circle--${stage.status}`}>
                {stageIcon(stage.status)}
              </div>
              <span className="lifecycle-stepper-label">{stage.label}</span>
            </div>
          </div>
        ))}
      </div>
      {errorMessage && <p className="history-error">{errorMessage}</p>}
      {onRetry && (
        <button className="secondary-button history-retry-button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

function formatDateTime(value: string): string {
  return formatTimestamp(value)
}

function formatCoordinate(value: number): string {
  return value.toFixed(5)
}

function itemLabel(item: HistoryItem['items'][number]): string {
  const parts = [item.objectLabel?.name, item.materialLabel?.name, item.brandLabel?.name].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : 'Unspecified item'
}

export function HistoryPanel() {
  const { sessionToken, guestId, user } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const [reports, setReports] = useState<HistoryItem[]>([])
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([])
  const [localThumbnails, setLocalThumbnails] = useState<Map<string, string>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingSpotId, setEditingSpotId] = useState<string | null>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { pickedUpFilter, datePreset } = useInsightsFilterStore()

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' })
    if (!sessionToken && guestId) {
      params.set('guestId', guestId)
    }
    const pu = pickedUpFilterToParam(pickedUpFilter)
    if (pu) params.set('picked_up', pu)
    const since = presetToSince(datePreset)
    if (since) params.set('since', since)

    return `${API_BASE}/spots?${params.toString()}`
  }, [sessionToken, guestId, pickedUpFilter, datePreset])

  const loadHistory = useCallback(async () => {
    if (!sessionToken && !guestId) {
      setReports([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const headers: Record<string, string> = {}
      if (sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`
      }

      const response = await fetch(requestUrl, { headers })
      if (!response.ok) {
        const body = await response.text()
        throw new Error(body || `${response.status} ${response.statusText}`)
      }

      const payload = (await response.json()) as { spots?: HistoryItem[] }
      setReports(payload.spots || [])
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load pick history'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [guestId, requestUrl, sessionToken])

  const loadOutbox = useCallback(async () => {
    const all = await getOutboxItems()
    setOutboxItems(all)
  }, [])

  const retryDetection = useCallback(async (id: string) => {
    const headers: Record<string, string> = {}
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    const params = new URLSearchParams()
    if (!sessionToken && guestId) params.set('guestId', guestId)

    await fetch(`${API_BASE}/spots/${id}/retry?${params.toString()}`, { method: 'POST', headers })
    void loadHistory()
  }, [sessionToken, guestId, loadHistory])

  const retrySync = useCallback(async () => {
    await flushOutbox({
      apiBase: API_BASE,
      sessionToken,
      currentUserId: user?.id ?? null,
      currentGuestId: guestId ?? null,
    })
    void loadOutbox()
  }, [sessionToken, user, guestId, loadOutbox])

  const startDelete = useCallback((spotId: string) => {
    setConfirmDeleteId(null)
    setPendingDeleteId(spotId)
    setReports(prev => prev.filter(r => r.id !== spotId))

    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    deleteTimerRef.current = setTimeout(async () => {
      setPendingDeleteId(null)
      deleteTimerRef.current = null

      const headers: Record<string, string> = {}
      if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

      const params = new URLSearchParams()
      if (!sessionToken && guestId) params.set('guestId', guestId)

      try {
        await fetch(`${API_BASE}/spots/${spotId}?${params.toString()}`, { method: 'DELETE', headers })
        window.dispatchEvent(new Event('picks-changed'))
      } catch {
        void loadHistory()
      }
    }, 3000)
  }, [sessionToken, guestId, loadHistory])

  const undoDelete = useCallback(() => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current)
      deleteTimerRef.current = null
    }
    setPendingDeleteId(null)
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const urls = new Map<string, string>()
    for (const item of outboxItems) {
      if (item.thumbnailBlob) {
        urls.set(item.id, URL.createObjectURL(item.thumbnailBlob))
      }
    }
    setLocalThumbnails(urls)
    return () => { for (const url of urls.values()) URL.revokeObjectURL(url) }
  }, [outboxItems])

  const refresh = useCallback(() => {
    void loadHistory()
    void loadOutbox()
  }, [loadHistory, loadOutbox])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const onPicksChanged = () => refresh()
    window.addEventListener('picks-changed', onPicksChanged)
    return () => window.removeEventListener('picks-changed', onPicksChanged)
  }, [refresh])

  const rows = useMemo((): Row[] => {
    const serverIds = new Set(reports.map(r => r.id))
    const since = presetToSince(datePreset)
    const localOnly = outboxItems
      .filter(o => !serverIds.has(o.id))
      .filter(o => {
        if (pickedUpFilter === 'picked' && o.pickedUp === false) return false
        if (pickedUpFilter === 'spotted' && o.pickedUp !== false) return false
        if (since && o.capturedAt < since) return false
        return true
      })

    return [
      ...localOnly.map(item => ({ kind: 'local' as const, item })),
      ...reports.map(item => ({ kind: 'server' as const, item })),
    ].sort((a, b) => {
      const aTime = a.item.capturedAt
      const bTime = b.item.capturedAt
      return bTime.localeCompare(aTime)
    })
  }, [reports, outboxItems, pickedUpFilter, datePreset])

  const setPickCount = useUiStore((s) => s.setPickCount)
  useEffect(() => {
    setPickCount(rows.length)
  }, [rows.length, setPickCount])

  const hasInFlight = useMemo(() => rows.some((row) => {
    if (row.kind === 'local') return row.item.status === 'pending' || row.item.status === 'uploading'
    return row.item.status === 'queued' || row.item.status === 'processing'
  }), [rows])

  return (
    <fieldset className="page-card history-panel">
      <legend>My Picks</legend>
      <header className="history-header">
        <CountdownButton
          intervalSeconds={hasInFlight ? 3 : 30}
          isLoading={isLoading}
          disabled={!isOnline}
          onRefresh={refresh}
        />
      </header>

      {error && <p className="error-message">{error}</p>}

      {!isLoading && rows.length === 0 && (
        <p className="history-empty">
          No picks yet. Take or import a photo to log your first pick.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="history-list">
          {rows.map((row) => {
            const { stages, errorMessage } = mapRowToStages(row)
            const isFailed = stages.some(s => s.status === 'failed')
            const onRetry = isFailed
              ? row.kind === 'local'
                ? () => { void retrySync() }
                : () => { void retryDetection(row.item.id) }
              : null

            const thumbSrc = row.kind === 'local'
              ? localThumbnails.get(row.item.id) ?? null
              : `${API_BASE}/spots/${row.item.id}/thumbnail`

            const thumbnail = thumbSrc
              ? <img
                  className="history-thumb"
                  src={thumbSrc}
                  alt=""
                  onClick={() => setLightboxSrc(thumbSrc)}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              : null

            const serverItem = row.kind === 'server' ? row.item : null

            return (
              <li key={row.item.id} className="history-card">
                <div className="history-card-body">
                  <div className="history-card-info">
                    <span className="history-timestamp">
                      {formatDateTime(row.item.capturedAt)}
                      {(row.kind === 'server' ? !row.item.pickedUp : row.item.pickedUp === false) && (
                        <span className="history-spotted-badge">Spotted</span>
                      )}
                      {row.kind === 'server' && (
                        <>
                          <button
                            className="history-edit-btn"
                            title="Edit"
                            onClick={() => setEditingSpotId(editingSpotId === row.item.id ? null : row.item.id)}
                          >
                            &#9998;
                          </button>
                          <button
                            className="history-delete-btn"
                            title="Delete"
                            onClick={() => setConfirmDeleteId(row.item.id)}
                          >
                            &#128465;
                          </button>
                        </>
                      )}
                    </span>

                    <LifecycleStepper stages={stages} errorMessage={errorMessage} onRetry={onRetry} />

                    <p className="history-meta">
                      {formatCoordinate(row.item.latitude)}, {formatCoordinate(row.item.longitude)} | accuracy {Math.round(row.item.accuracyMeters)}m
                    </p>

                    {row.kind === 'local' && row.item.attempts > 0 && (
                      <p className="history-meta">Attempt {row.item.attempts}</p>
                    )}

                    {serverItem?.status === 'completed' && serverItem.items.length === 0 && (
                      <p className="history-meta">No detectable litter items were found.</p>
                    )}

                    {serverItem && serverItem.items.length > 0 && (
                      <ul className="history-items">
                        {serverItem.items.map((detected) => (
                          <li key={detected.id} className="history-item-row">
                            <span>{itemLabel(detected)}</span>
                            <span>
                              {detected.weightGrams !== null ? `${Math.round(detected.weightGrams)} g` : ''}
                              {detected.weightGrams !== null && detected.confidence !== null ? ' · ' : ''}
                              {detected.confidence !== null ? `${Math.round(detected.confidence * 100)}%` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {thumbnail}
                </div>
                {editingSpotId === row.item.id && row.kind === 'server' && (
                  <SpotEditor
                    spotId={row.item.id}
                    pickedUp={row.item.pickedUp}
                    items={row.item.items}
                    onSave={() => { void loadHistory() }}
                    onCancel={() => setEditingSpotId(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {confirmDeleteId && (
        <div className="lightbox-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Delete this pick? This cannot be undone.</p>
            <div className="confirm-dialog-actions">
              <button className="secondary-button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button className="danger-button" onClick={() => startDelete(confirmDeleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteId && (
        <div className="undo-toast">
          <span>Pick deleted</span>
          <button className="undo-toast-btn" onClick={undoDelete}>Undo</button>
        </div>
      )}

      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <img className="lightbox-image" src={lightboxSrc} alt="" />
        </div>
      )}
    </fieldset>
  )
}
