import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useAuthStore } from '../stores/authStore'
import { useInsightsFilterStore, type CleanupFilter } from '../stores/insightsFilterStore'

import { API_BASE } from '../lib/apiBase'
const MOBILE_BREAKPOINT = '(max-width: 640px)'

type Scope = 'mine' | 'all'

interface CleanupDateLite {
  id: string
  start_at: string
  end_at: string
  location_name: string | null
  spotCount: number
}

interface CleanupListItem {
  cleanup: { id: string; name: string }
  dates: CleanupDateLite[]
  userRole: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 3l3 3-3 3" />
    </svg>
  )
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 3l-3 3 3 3" />
    </svg>
  )
}

function triggerLabel(filter: CleanupFilter, items: CleanupListItem[]): string {
  if (!filter) return 'All'
  if (filter.kind === 'cleanup') return filter.cleanupName
  const cleanup = items.find(i => i.cleanup.id === filter.cleanupId)
  const date = cleanup?.dates.find(d => d.id === filter.cleanupDateId)
  if (!date) return filter.cleanupName
  return `${filter.cleanupName} · ${formatDate(date.start_at)}`
}

export function CleanupFilterDropdown({ disabled }: { disabled?: boolean }) {
  const { sessionToken } = useAuthStore()
  const { cleanupFilter, setCleanupFilter } = useInsightsFilterStore()

  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('mine')
  const [items, setItems] = useState<CleanupListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [drilldownCleanupId, setDrilldownCleanupId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT).matches,
  )

  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(MOBILE_BREAKPOINT)
    const handle = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handle)
    return () => mq.removeEventListener('change', handle)
  }, [])

  const fetchCleanups = useCallback(async (s: Scope) => {
    if (!sessionToken) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (s === 'mine') params.set('member_only', 'true')
      const response = await axios.get(`${API_BASE}/cleanups/search?${params}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      })
      const list: CleanupListItem[] = (response.data.items || [])
        .map((it: any) => ({
          cleanup: { id: it.cleanup.id, name: it.cleanup.name },
          dates: (it.dates || [])
            .filter((d: any) => (d.spotCount || 0) > 0)
            .map((d: any) => ({
              id: d.id, start_at: d.start_at, end_at: d.end_at, location_name: d.location_name,
              spotCount: d.spotCount || 0,
            })),
          userRole: it.userRole,
        }))
        .filter((it: CleanupListItem) => it.dates.length > 0)
      list.sort((a, b) => {
        const aLatest = a.dates[a.dates.length - 1]?.start_at || ''
        const bLatest = b.dates[b.dates.length - 1]?.start_at || ''
        return bLatest.localeCompare(aLatest)
      })
      setItems(list)
    } finally {
      setIsLoading(false)
    }
  }, [sessionToken])

  useEffect(() => {
    if (open) fetchCleanups(scope)
  }, [open, scope, fetchCleanups])

  useEffect(() => {
    if (!open || isMobile) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setDrilldownCleanupId(null)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (drilldownCleanupId) setDrilldownCleanupId(null)
        else setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, isMobile, drilldownCleanupId])

  function close() {
    setOpen(false)
    setDrilldownCleanupId(null)
  }

  function applyAndClose(next: CleanupFilter) {
    setCleanupFilter(next)
    close()
  }

  function pickCleanupRow(item: CleanupListItem) {
    if (item.dates.length > 1) {
      setDrilldownCleanupId(item.cleanup.id)
      return
    }
    const only = item.dates[0]
    if (!only) return
    applyAndClose({
      kind: 'date',
      cleanupDateId: only.id,
      cleanupId: item.cleanup.id,
      cleanupName: item.cleanup.name,
    })
  }

  const drilldownItem = drilldownCleanupId
    ? items.find(i => i.cleanup.id === drilldownCleanupId)
    : null

  const triggerText = triggerLabel(cleanupFilter, items)
  const isActive = !!cleanupFilter
  const isDisabled = !!disabled

  const panel = (
    <>
      {!drilldownItem && (
        <>
          <div className="cleanup-filter-scope">
            <button
              className={`cleanup-filter-scope-btn${scope === 'mine' ? ' cleanup-filter-scope-btn--active' : ''}`}
              onClick={() => setScope('mine')}
              type="button"
            >Mine</button>
            <button
              className={`cleanup-filter-scope-btn${scope === 'all' ? ' cleanup-filter-scope-btn--active' : ''}`}
              onClick={() => setScope('all')}
              type="button"
            >All</button>
          </div>
          <button
            className={`cleanup-filter-row${!cleanupFilter ? ' cleanup-filter-row--active' : ''}`}
            onClick={() => applyAndClose(null)}
            type="button"
          >
            <span className="cleanup-filter-row-name">All cleanups</span>
          </button>
          {isLoading && items.length === 0 && (
            <div className="cleanup-filter-status">Loading…</div>
          )}
          {!isLoading && items.length === 0 && (
            <div className="cleanup-filter-status">No cleanups</div>
          )}
          {items.map(item => {
            const isCurrent = cleanupFilter?.cleanupId === item.cleanup.id
            const dateCount = item.dates.length
            return (
              <button
                key={item.cleanup.id}
                className={`cleanup-filter-row${isCurrent ? ' cleanup-filter-row--active' : ''}`}
                onClick={() => pickCleanupRow(item)}
                type="button"
              >
                <span className="cleanup-filter-row-name">{item.cleanup.name}</span>
                {dateCount > 1 && (
                  <span className="cleanup-filter-row-meta">
                    {dateCount} dates
                    <ChevronRight />
                  </span>
                )}
                {dateCount === 1 && (
                  <span className="cleanup-filter-row-meta cleanup-filter-row-meta--muted">
                    {formatDate(item.dates[0].start_at)}
                  </span>
                )}
              </button>
            )
          })}
        </>
      )}

      {drilldownItem && (
        <>
          <div className="cleanup-filter-back">
            <button
              className="cleanup-filter-back-btn"
              onClick={() => setDrilldownCleanupId(null)}
              type="button"
            ><ChevronLeft /> {drilldownItem.cleanup.name}</button>
          </div>
          <button
            className={`cleanup-filter-row${cleanupFilter?.kind === 'cleanup' && cleanupFilter.cleanupId === drilldownItem.cleanup.id ? ' cleanup-filter-row--active' : ''}`}
            onClick={() => applyAndClose({
              kind: 'cleanup',
              cleanupId: drilldownItem.cleanup.id,
              cleanupName: drilldownItem.cleanup.name,
            })}
            type="button"
          >
            <span className="cleanup-filter-row-name">All dates</span>
            <span className="cleanup-filter-row-meta cleanup-filter-row-meta--muted">{drilldownItem.dates.length}</span>
          </button>
          {drilldownItem.dates.map(d => {
            const isCurrent = cleanupFilter?.kind === 'date' && cleanupFilter.cleanupDateId === d.id
            return (
              <button
                key={d.id}
                className={`cleanup-filter-row${isCurrent ? ' cleanup-filter-row--active' : ''}`}
                onClick={() => applyAndClose({
                  kind: 'date',
                  cleanupDateId: d.id,
                  cleanupId: drilldownItem.cleanup.id,
                  cleanupName: drilldownItem.cleanup.name,
                })}
                type="button"
              >
                <span className="cleanup-filter-row-name">{formatDate(d.start_at)}</span>
                {d.location_name && (
                  <span className="cleanup-filter-row-meta cleanup-filter-row-meta--muted">{d.location_name}</span>
                )}
              </button>
            )
          })}
        </>
      )}
    </>
  )

  return (
    <div className="context-dropdown cleanup-filter-dropdown" ref={ref}>
      <button
        className={`context-dropdown-trigger${isActive ? ' context-dropdown-trigger--active' : ''}`}
        onClick={() => !isDisabled && setOpen(!open)}
        disabled={isDisabled}
        type="button"
      >
        <span className="context-dropdown-label">Cleanup:</span>
        <span className="context-dropdown-value">{triggerText}</span>
        <ChevronDown />
      </button>

      {open && !isMobile && (
        <div className="context-dropdown-menu cleanup-filter-menu">
          {panel}
        </div>
      )}

      {open && isMobile && createPortal(
        <>
          <div className="cleanup-filter-backdrop" onClick={close} />
          <div className="cleanup-filter-sheet" role="dialog" aria-modal="true">
            <div className="cleanup-filter-sheet-handle" />
            <div className="cleanup-filter-sheet-header">
              <span>Cleanup</span>
              <button className="cleanup-filter-sheet-close" onClick={close} aria-label="Close" type="button">×</button>
            </div>
            <div className="cleanup-filter-sheet-body">
              {panel}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
