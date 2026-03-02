import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../stores/authStore'

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

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString()
}

function formatCoordinate(value: number): string {
  return value.toFixed(5)
}

function statusClass(status: string): string {
  if (status === 'completed') return 'history-status-completed'
  if (status === 'processing') return 'history-status-processing'
  if (status === 'queued') return 'history-status-queued'
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

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadHistory()
    }, 15000)

    return () => {
      window.clearInterval(interval)
    }
  }, [loadHistory])

  return (
    <section className="history-panel">
      <header className="history-header">
        <h2>Upload History</h2>
        <button className="secondary-button" onClick={() => void loadHistory()} disabled={isLoading}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <p className="error-message">{error}</p>}

      {!isLoading && reports.length === 0 && (
        <p className="history-empty">No uploads yet. Capture or import a photo to start your history.</p>
      )}

      {reports.length > 0 && (
        <ul className="history-list">
          {reports.map((report) => (
            <li key={report.id} className="history-card">
              <div className="history-card-header">
                <strong className={`history-status ${statusClass(report.status)}`}>{report.status}</strong>
                <span>{formatDateTime(report.capturedAt)}</span>
              </div>

              <p className="history-meta">
                {formatCoordinate(report.latitude)}, {formatCoordinate(report.longitude)} | accuracy {Math.round(report.accuracyMeters)}m
              </p>

              {report.processingError && <p className="history-error">{report.processingError}</p>}

              {report.status === 'completed' && report.items.length === 0 && (
                <p className="history-meta">No detectable litter items were found.</p>
              )}

              {report.items.length > 0 && (
                <ul className="history-items">
                  {report.items.map((item) => (
                    <li key={item.id} className="history-item-row">
                      <span>{itemLabel(item)}</span>
                      <span>
                        {item.confidence !== null ? `${Math.round(item.confidence * 100)}%` : 'n/a'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
