import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useUiStore } from '../stores/uiStore'
import { useInsightsFilterStore, presetToSince, pickedUpFilterToParam } from '../stores/insightsFilterStore'
import { flushOutbox, getOutboxItems, type OutboxItem } from '../lib/pendingPicks'
import { formatCoord } from '@cleancentive/shared'
import { formatTimestamp } from '../utils/formatTimestamp'
import { CountdownButton } from './CountdownButton'
import { SpotEditor } from './SpotEditor'

import { API_BASE } from '../lib/apiBase'

interface HistoryItem {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | string
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number | null
  pickedUp: boolean
  subjectKind?: 'litter' | 'plant'
  processingError: string | null
  detectionCompletedAt: string | null
  items: {
    id: string
    objectLabel: { id: string; name: string; scientificName?: string | null } | null
    materialLabel: { id: string; name: string } | null
    brandLabel: { id: string; name: string } | null
    weightGrams: number | null
    confidence: number | null
    plantInvasive: { list: 'infoflora_black' | 'infoflora_watch'; recommendedAction: string } | null
  }[]
}

type Row =
  | { kind: 'local'; item: OutboxItem }
  | { kind: 'server'; item: HistoryItem }

type StageStatus = 'not-reached' | 'in-progress' | 'success' | 'failed'

type StageKey = 'local' | 'synced' | 'detected'

interface StageState {
  key: StageKey
  status: StageStatus
}

function formatRetryCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

function mapRowToStages(row: Row): { stages: [StageState, StageState, StageState]; errorMessage: string | null } {
  if (row.kind === 'local') {
    const s = row.item.status
    return {
      stages: [
        { key: 'local', status: s === 'failed' ? 'failed' : 'in-progress' },
        { key: 'synced', status: 'not-reached' },
        { key: 'detected', status: 'not-reached' },
      ],
      errorMessage: s === 'failed' ? row.item.lastError : null,
    }
  }

  const s = row.item.status
  if (s === 'completed') {
    return {
      stages: [
        { key: 'local', status: 'success' },
        { key: 'synced', status: 'success' },
        { key: 'detected', status: 'success' },
      ],
      errorMessage: null,
    }
  }
  if (s === 'failed') {
    return {
      stages: [
        { key: 'local', status: 'success' },
        { key: 'synced', status: 'success' },
        { key: 'detected', status: 'failed' },
      ],
      errorMessage: row.item.processingError,
    }
  }
  // queued or processing
  return {
    stages: [
      { key: 'local', status: 'success' },
      { key: 'synced', status: 'success' },
      { key: 'detected', status: 'in-progress' },
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

function LifecycleStepper({ stages, errorMessage, onRetry, retryInMs, t }: {
  stages: [StageState, StageState, StageState]
  errorMessage: string | null
  onRetry: (() => void) | null
  retryInMs: number | null
  t: TFunction
}) {
  return (
    <div className="lifecycle-stepper">
      <div className="lifecycle-stepper-row">
        {stages.map((stage, i) => (
          <div key={stage.key} className="lifecycle-stepper-segment">
            {i > 0 && (
              <div className={`lifecycle-stepper-line${stage.status !== 'not-reached' ? ' lifecycle-stepper-line--done' : ''}`} />
            )}
            <div className="lifecycle-stepper-stage">
              <div className={`lifecycle-stepper-circle lifecycle-stepper-circle--${stage.status}`}>
                {stageIcon(stage.status)}
              </div>
              <span className="lifecycle-stepper-label">{t(`panel.stages.${stage.key}`)}</span>
            </div>
          </div>
        ))}
      </div>
      {errorMessage && <p className="history-error">{errorMessage}</p>}
      {retryInMs !== null && retryInMs > 0 && (
        <p className="history-retry-countdown">{t('panel.retryingIn', { time: formatRetryCountdown(retryInMs) })}</p>
      )}
      {onRetry && (
        <button className="secondary-button history-retry-button" onClick={onRetry}>
          {t('panel.retryNow')}
        </button>
      )}
    </div>
  )
}

function formatDateTime(value: string): string {
  return formatTimestamp(value)
}

function itemLabel(item: HistoryItem['items'][number], t: TFunction): string {
  const objectName = item.objectLabel?.name
  const scientific = item.objectLabel?.scientificName
  const head = scientific && objectName ? `${objectName} (${scientific})` : objectName
  const parts = [head, item.materialLabel?.name, item.brandLabel?.name].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : t('panel.unspecifiedItem')
}

export function HistoryPanel() {
  const { t } = useTranslation(['spot', 'common'])
  const { sessionToken, guestId, user } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const [reports, setReports] = useState<HistoryItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([])
  const [localThumbnails, setLocalThumbnails] = useState<Map<string, string>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingSpotId, setEditingSpotId] = useState<string | null>(null)
  const [expandedActions, setExpandedActions] = useState<Set<string>>(() => new Set())
  const [tickNow, setTickNow] = useState(() => Date.now())
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasFutureRetry = useMemo(
    () => outboxItems.some((item) => item.status === 'failed' && item.nextRetryAt > tickNow),
    [outboxItems, tickNow],
  )

  useEffect(() => {
    if (!hasFutureRetry) return
    const id = window.setInterval(() => setTickNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasFutureRetry])

  const { pickedUpFilter, datePreset } = useInsightsFilterStore()

  const buildRequestUrl = useCallback((cursor?: string) => {
    const params = new URLSearchParams({ limit: '50' })
    if (!sessionToken && guestId) {
      params.set('guestId', guestId)
    }
    const pu = pickedUpFilterToParam(pickedUpFilter)
    if (pu) params.set('picked_up', pu)
    const since = presetToSince(datePreset)
    if (since) params.set('since', since)
    if (cursor) params.set('before', cursor)

    return `${API_BASE}/spots?${params.toString()}`
  }, [sessionToken, guestId, pickedUpFilter, datePreset])

  const loadHistory = useCallback(async (cursor?: string) => {
    if (!sessionToken && !guestId) {
      setReports([])
      setNextCursor(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const headers: Record<string, string> = {}
      if (sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`
      }

      const response = await fetch(buildRequestUrl(cursor), { headers })
      if (!response.ok) {
        const body = await response.text()
        throw new Error(body || `${response.status} ${response.statusText}`)
      }

      const payload = (await response.json()) as { spots?: HistoryItem[]; nextCursor?: string | null }
      const spots = payload.spots || []
      if (cursor) {
        setReports((prev) => [...prev, ...spots])
      } else {
        setReports(spots)
      }
      setNextCursor(payload.nextCursor ?? null)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : t('panel.loadFailed')
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [guestId, buildRequestUrl, sessionToken, t])

  const loadMore = useCallback(() => {
    if (!nextCursor || isLoading) return
    void loadHistory(nextCursor)
  }, [nextCursor, isLoading, loadHistory])

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
      <legend>{t('panel.legend')}</legend>
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
          {t('panel.empty')}
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
            const retryInMs = row.kind === 'local' && row.item.status === 'failed' && row.item.nextRetryAt > tickNow
              ? row.item.nextRetryAt - tickNow
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
                        <span className="history-spotted-badge">{t('panel.spotted')}</span>
                      )}
                      {row.kind === 'server' && (
                        <>
                          <button
                            className="history-edit-btn"
                            title={t('panel.edit')}
                            onClick={() => setEditingSpotId(editingSpotId === row.item.id ? null : row.item.id)}
                          >
                            &#9998;
                          </button>
                          <button
                            className="history-delete-btn"
                            title={t('panel.delete')}
                            onClick={() => setConfirmDeleteId(row.item.id)}
                          >
                            &#128465;
                          </button>
                        </>
                      )}
                    </span>

                    <LifecycleStepper stages={stages} errorMessage={errorMessage} onRetry={onRetry} retryInMs={retryInMs} t={t} />

                    <p className="history-meta">
                      {t('detail.metaAccuracy', {
                        lat: formatCoord(row.item.latitude),
                        lng: formatCoord(row.item.longitude),
                        accuracy: row.item.accuracyMeters !== null ? `±${Math.round(row.item.accuracyMeters)}m` : t('detail.accuracyUnknown'),
                      })}
                    </p>

                    {row.kind === 'local' && row.item.attempts > 0 && (
                      <p className="history-meta">{t('panel.attempt', { count: row.item.attempts })}</p>
                    )}

                    {serverItem?.status === 'completed' && serverItem.items.length === 0 && (
                      <p className="history-meta">
                        {serverItem.subjectKind === 'plant'
                          ? t('panel.plantNotConfident')
                          : t('panel.noLitterFound')}
                      </p>
                    )}

                    {serverItem && serverItem.items.length > 0 && (
                      <ul className="history-items">
                        {serverItem.items.map((detected) => {
                          const isExpanded = expandedActions.has(detected.id)
                          return (
                            <li key={detected.id} className="history-item-row">
                              <span>
                                {itemLabel(detected, t)}
                                {detected.plantInvasive && (
                                  <>
                                    {' · '}
                                    <span className={`plant-id-badge plant-id-badge--${detected.plantInvasive.list === 'infoflora_black' ? 'black' : 'watch'}`}>
                                      {detected.plantInvasive.list === 'infoflora_black' ? t('panel.invasiveBlack') : t('panel.invasiveWatch')}
                                    </span>
                                    {' '}
                                    <button
                                      type="button"
                                      className="link-button history-invasive-toggle"
                                      onClick={() => setExpandedActions((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(detected.id)) next.delete(detected.id)
                                        else next.add(detected.id)
                                        return next
                                      })}
                                    >
                                      {isExpanded ? t('panel.hide') : t('panel.howToRemove')}
                                    </button>
                                  </>
                                )}
                              </span>
                              <span>
                                {detected.weightGrams !== null ? `${Math.round(detected.weightGrams)} g` : ''}
                                {detected.weightGrams !== null && detected.confidence !== null ? ' · ' : ''}
                                {detected.confidence !== null ? `${Math.round(detected.confidence * 100)}%` : ''}
                              </span>
                              {detected.plantInvasive && isExpanded && (
                                <p className="plant-id-action history-invasive-action">{detected.plantInvasive.recommendedAction}</p>
                              )}
                            </li>
                          )
                        })}
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
                    subjectKind={row.item.subjectKind ?? 'litter'}
                    onSave={() => { void loadHistory() }}
                    onCancel={() => setEditingSpotId(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {nextCursor && (
        <div className="history-load-more">
          <button
            type="button"
            className="secondary-button"
            onClick={loadMore}
            disabled={isLoading}
          >
            {isLoading ? t('common:actions.loading') : t('panel.loadMore')}
          </button>
        </div>
      )}

      {confirmDeleteId && (
        <div className="lightbox-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>{t('panel.deleteConfirm')}</p>
            <div className="confirm-dialog-actions">
              <button className="secondary-button" onClick={() => setConfirmDeleteId(null)}>{t('common:actions.cancel')}</button>
              <button className="danger-button" onClick={() => startDelete(confirmDeleteId)}>{t('common:actions.delete')}</button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteId && (
        <div className="undo-toast">
          <span>{t('panel.pickDeleted')}</span>
          <button className="undo-toast-btn" onClick={undoDelete}>{t('panel.undo')}</button>
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
