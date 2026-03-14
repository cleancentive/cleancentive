import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { getOutboxItems, type OutboxItem } from '../lib/uploadOutbox'
import { formatTimestamp } from '../utils/formatTimestamp'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'

interface HistoryItem {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | string
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number
  processingError: string | null
  analysisCompletedAt: string | null
  items: {
    id: string
    category: string | null
    material: string | null
    brand: string | null
    weightGrams: number | null
    confidence: number | null
  }[]
}

type Row =
  | { kind: 'local'; item: OutboxItem }
  | { kind: 'server'; item: HistoryItem }

function formatDateTime(value: string): string {
  return formatTimestamp(value)
}

function formatCoordinate(value: number): string {
  return value.toFixed(5)
}

function serverStatusLabel(status: string): string {
  if (status === 'completed') return 'Completed'
  if (status === 'processing') return 'Processing'
  if (status === 'queued') return 'Queued'
  if (status === 'failed') return 'Processing failed'
  return status
}

function serverStatusClass(status: string): string {
  if (status === 'completed') return 'history-status-completed'
  if (status === 'processing') return 'history-status-processing'
  if (status === 'queued') return 'history-status-queued'
  if (status === 'failed') return 'history-status-failed'
  return 'history-status-queued'
}

function localStatusLabel(status: OutboxItem['status']): string {
  if (status === 'pending') return 'Upload pending'
  if (status === 'uploading') return 'Uploading\u2026'
  if (status === 'failed') return 'Upload failed'
  return status
}

function localStatusClass(status: OutboxItem['status']): string {
  if (status === 'pending') return 'history-status-queued'
  if (status === 'uploading') return 'history-status-processing'
  if (status === 'failed') return 'history-status-failed'
  return 'history-status-queued'
}

function itemLabel(item: HistoryItem['items'][number]): string {
  const parts = [item.category, item.material, item.brand].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : 'Unspecified item'
}

export function HistoryPanel() {
  const { sessionToken, guestId } = useAuthStore()
  const [reports, setReports] = useState<HistoryItem[]>([])
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([])
  const [localThumbnails, setLocalThumbnails] = useState<Map<string, string>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' })
    if (!sessionToken && guestId) {
      params.set('guestId', guestId)
    }

    return `${API_BASE}/cleanup/reports?${params.toString()}`
  }, [sessionToken, guestId])

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

      const payload = (await response.json()) as { reports?: HistoryItem[] }
      setReports(payload.reports || [])
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load upload history'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [guestId, requestUrl, sessionToken])

  const loadOutbox = useCallback(async () => {
    const all = await getOutboxItems()
    setOutboxItems(all)
  }, [])

  const retryReport = useCallback(async (id: string) => {
    const headers: Record<string, string> = {}
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

    const params = new URLSearchParams()
    if (!sessionToken && guestId) params.set('guestId', guestId)

    await fetch(`${API_BASE}/cleanup/reports/${id}/retry?${params.toString()}`, { method: 'POST', headers })
    void loadHistory()
  }, [sessionToken, guestId, loadHistory])

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

  useEffect(() => {
    void loadHistory()
    void loadOutbox()
  }, [loadHistory, loadOutbox])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadHistory()
      void loadOutbox()
    }, 15000)

    return () => {
      window.clearInterval(interval)
    }
  }, [loadHistory, loadOutbox])

  const rows = useMemo((): Row[] => {
    const serverIds = new Set(reports.map(r => r.id))
    const localOnly = outboxItems.filter(o => !serverIds.has(o.id))

    return [
      ...localOnly.map(item => ({ kind: 'local' as const, item })),
      ...reports.map(item => ({ kind: 'server' as const, item })),
    ].sort((a, b) => {
      const aTime = a.item.capturedAt
      const bTime = b.item.capturedAt
      return bTime.localeCompare(aTime)
    })
  }, [reports, outboxItems])

  return (
    <section className="history-panel">
      <header className="history-header">
        <h2>Upload History</h2>
        <button
          className="secondary-button"
          onClick={() => { void loadHistory(); void loadOutbox() }}
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <p className="error-message">{error}</p>}

      {!isLoading && rows.length === 0 && (
        <p className="history-empty">No uploads yet. Capture or import a photo to start your history.</p>
      )}

      {rows.length > 0 && (
        <ul className="history-list">
          {rows.map((row) => {
            if (row.kind === 'local') {
              const { item } = row
              return (
                <li key={item.id} className="history-card">
                  <div className="history-card-header">
                    <strong className={`history-status ${localStatusClass(item.status)}`}>
                      {localStatusLabel(item.status)}
                    </strong>
                    <span>{formatDateTime(item.capturedAt)}</span>
                    {localThumbnails.get(item.id) && (
                      <img className="history-thumb" src={localThumbnails.get(item.id)} alt="" />
                    )}
                  </div>

                  <p className="history-meta">
                    {formatCoordinate(item.latitude)}, {formatCoordinate(item.longitude)} | accuracy {Math.round(item.accuracyMeters)}m
                  </p>

                  {item.lastError && <p className="history-error">{item.lastError}</p>}
                  {item.attempts > 0 && (
                    <p className="history-meta">Attempt {item.attempts}</p>
                  )}
                </li>
              )
            }

            const { item } = row
            return (
              <li key={item.id} className="history-card">
                <div className="history-card-header">
                  <strong className={`history-status ${serverStatusClass(item.status)}`}>
                    {serverStatusLabel(item.status)}
                  </strong>
                  <span>{formatDateTime(item.capturedAt)}</span>
                  <img
                    className="history-thumb"
                    src={`${API_BASE}/cleanup/reports/${item.id}/thumbnail`}
                    alt=""
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>

                <p className="history-meta">
                  {formatCoordinate(item.latitude)}, {formatCoordinate(item.longitude)} | accuracy {Math.round(item.accuracyMeters)}m
                </p>

                {item.processingError && <p className="history-error">{item.processingError}</p>}

                {item.status === 'failed' && (
                  <button
                    className="secondary-button history-retry-button"
                    onClick={() => { void retryReport(item.id) }}
                  >
                    Retry analysis
                  </button>
                )}

                {item.status === 'completed' && item.items.length === 0 && (
                  <p className="history-meta">No detectable litter items were found.</p>
                )}

                {item.items.length > 0 && (
                  <ul className="history-items">
                    {item.items.map((detected) => (
                      <li key={detected.id} className="history-item-row">
                        <span>{itemLabel(detected)}</span>
                        <span>
                          {detected.confidence !== null ? `${Math.round(detected.confidence * 100)}%` : 'n/a'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
