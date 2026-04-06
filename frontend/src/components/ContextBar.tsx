import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useTeamStore } from '../stores/teamStore'
import { useCleanupStore } from '../stores/cleanupStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useInsightsFilterStore, type DatePreset, type PickedUpFilter } from '../stores/insightsFilterStore'

const PICKED_UP_PRESETS: Array<{ value: PickedUpFilter; label: string }> = [
  { value: 'picked', label: 'Picked' },
  { value: 'spotted', label: 'Spotted' },
  { value: 'all', label: 'All' },
]

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '1y', label: '1y' },
  { value: 'all', label: 'All' },
]

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

interface RouteConfig {
  dropdownsEnabled: boolean
  dropdownsAreFilters: boolean
  myEnabled: boolean
  myForcedOn: boolean
  pickedUpEnabled: boolean
  dateEnabled: boolean
}

function getRouteConfig(pathname: string): RouteConfig {
  if (pathname === '/') {
    return {
      dropdownsEnabled: true,
      dropdownsAreFilters: false,
      myEnabled: false,
      myForcedOn: true,
      pickedUpEnabled: true,
      dateEnabled: true,
    }
  }
  if (pathname === '/insights' || pathname === '/map') {
    return {
      dropdownsEnabled: true,
      dropdownsAreFilters: true,
      myEnabled: true,
      myForcedOn: false,
      pickedUpEnabled: true,
      dateEnabled: true,
    }
  }
  if (pathname === '/teams' || pathname === '/cleanups') {
    return {
      dropdownsEnabled: true,
      dropdownsAreFilters: true,
      myEnabled: true,
      myForcedOn: false,
      pickedUpEnabled: false,
      dateEnabled: false,
    }
  }
  // Detail pages, feedback, profile, steward, etc.
  return {
    dropdownsEnabled: false,
    dropdownsAreFilters: false,
    myEnabled: false,
    myForcedOn: false,
    pickedUpEnabled: false,
    dateEnabled: false,
  }
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  )
}

function Dropdown({ items, activeId, onSelect, onClear, label, emptyLabel, disabled }: {
  items: Array<{ id: string; name: string }>
  activeId: string | null
  onSelect: (id: string) => void
  onClear: () => void
  label: string
  emptyLabel: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const activeName = items.find(i => i.id === activeId)?.name
  const isDisabled = disabled || items.length === 0

  return (
    <div className="context-dropdown" ref={ref}>
      <button
        className="context-dropdown-trigger"
        onClick={() => !isDisabled && setOpen(!open)}
        disabled={isDisabled}
      >
        <span className="context-dropdown-label">{label}:</span>
        <span className="context-dropdown-value">{activeName || emptyLabel}</span>
        <ChevronDown />
      </button>
      {open && !isDisabled && (
        <div className="context-dropdown-menu">
          <button
            className={`context-dropdown-item ${!activeId ? 'context-dropdown-item--active' : ''}`}
            onClick={() => { onClear(); setOpen(false) }}
          >
            {emptyLabel}
          </button>
          {items.map(item => (
            <button
              key={item.id}
              className={`context-dropdown-item ${item.id === activeId ? 'context-dropdown-item--active' : ''}`}
              onClick={() => { onSelect(item.id); setOpen(false) }}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function isDateOngoing(startAt: string, endAt: string): boolean {
  const now = Date.now()
  return new Date(startAt).getTime() <= now && new Date(endAt).getTime() >= now
}

function hasActiveFilters(
  myFilter: boolean, pickedUpFilter: PickedUpFilter, datePreset: DatePreset,
  activeTeamId?: string | null, activeCleanupDateId?: string | null,
): boolean {
  return myFilter || pickedUpFilter !== 'all' || datePreset !== 'all'
    || !!activeTeamId || !!activeCleanupDateId
}

export function ContextBar() {
  const { user } = useAuthStore()
  const { myTeams: teamResults, fetchMyTeams, activateTeam, deactivateTeam } = useTeamStore()
  const { myCleanups: cleanupResults, fetchMyCleanups, activateDate, deactivateDate } = useCleanupStore()
  const { isOnline } = useConnectivityStore()
  const {
    datePreset, setDatePreset,
    pickedUpFilter, setPickedUpFilter,
    myFilter, setMyFilter,
    clearFilters,
  } = useInsightsFilterStore()
  const autoActivatedRef = useRef(false)
  const { pathname } = useLocation()
  const config = getRouteConfig(pathname)

  const effectiveMyFilter = config.myForcedOn || myFilter

  const refreshData = useCallback(() => {
    if (!user) return
    fetchMyTeams()
    fetchMyCleanups()
  }, [user, fetchMyTeams, fetchMyCleanups])

  // Initial load
  useEffect(() => {
    refreshData()
  }, [refreshData])

  // Poll every 5 minutes while online
  useEffect(() => {
    if (!user || !isOnline) return
    const id = setInterval(refreshData, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [user, isOnline, refreshData])

  const myCleanups = cleanupResults
    .filter(c => c.nearestDate)
    .filter(c => {
      if (!isOnline) return true
      const d = c.nearestDate!
      return isDateOngoing(d.start_at, d.end_at)
    })
    .map(c => ({ id: c.nearestDate!.id, name: c.cleanup.name }))

  // Auto-activate once on load if exactly one ongoing cleanup and none currently active
  useEffect(() => {
    if (autoActivatedRef.current) return
    if (!user || !isOnline) return
    if (myCleanups.length === 1 && !user.active_cleanup_date_id) {
      autoActivatedRef.current = true
      activateDate(myCleanups[0].id)
    }
    // Only attempt on initial data load, not on every change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCleanups.length])

  const barRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)

  useEffect(() => {
    const bar = barRef.current
    const ctx = contextRef.current
    const flt = filterRef.current
    if (!bar || !ctx || !flt) return

    let isStacked = false

    const update = () => {
      if (!bar.isConnected) return
      // Temporarily force single-line + auto width to measure natural sizes
      bar.classList.remove('context-bar--stacked')
      const origFlex = flt.style.flex
      flt.style.flex = '0 0 auto'

      const barWidth = bar.offsetWidth
      const ctxWidth = ctx.offsetWidth
      const fltWidth = flt.offsetWidth

      flt.style.flex = origFlex

      const gap = barWidth - ctxWidth - fltWidth
      // Hysteresis: stack at < 50px, unstack at > 120px
      const shouldStack = isStacked ? gap < 120 : gap < 50

      if (shouldStack) {
        bar.classList.add('context-bar--stacked')
        isStacked = true
        setStacked(true)
      } else {
        isStacked = false
        setStacked(false)
        const curveRight = barWidth - ctxWidth - 30
        const minRight = fltWidth + 20
        bar.style.setProperty('--curve-right', `${Math.max(curveRight, minRight)}px`)
      }
    }

    const observer = new ResizeObserver(update)
    observer.observe(bar)
    observer.observe(ctx)
    observer.observe(flt)
    update()
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  if (!user) return null

  const myTeams = teamResults
    .map(t => ({ id: t.team.id, name: t.team.name }))

  const dropdownEmptyLabel = config.dropdownsAreFilters ? 'All' : 'None'
  const filterMode = config.dropdownsAreFilters
  const anyFiltersActive = hasActiveFilters(myFilter, pickedUpFilter, datePreset, user.active_team_id, user.active_cleanup_date_id)
  const anyFilterEnabled = config.myEnabled || config.pickedUpEnabled || config.dateEnabled

  // Compound summary: "My picks in [TeamName]"
  const teamName = user.active_team_name || null
  const showCompoundSummary = effectiveMyFilter && teamName && config.dropdownsAreFilters

  return (
    <div
      ref={barRef}
      className={`context-bar${filterMode ? ' context-bar--filter-mode' : ''}${stacked ? ' context-bar--stacked' : ''}`}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <clipPath id="s-curve-clip" clipPathUnits="objectBoundingBox">
            <path d="M0.02,0 C0.01,0.4 0,0.6 0.02,1 L1,1 L1,0 Z" />
          </clipPath>
        </defs>
      </svg>
      <div
        ref={contextRef}
        className={`context-zone${!config.dropdownsEnabled ? ' context-zone--disabled' : ''}`}
        title="Controls which team and cleanup your picks join"
      >
        <Dropdown
          items={myTeams}
          activeId={user.active_team_id || null}
          onSelect={(id) => activateTeam(id)}
          onClear={() => deactivateTeam()}
          label="Team"
          emptyLabel={dropdownEmptyLabel}
          disabled={!config.dropdownsEnabled}
        />
        <Dropdown
          items={myCleanups}
          activeId={user.active_cleanup_date_id || null}
          onSelect={(id) => activateDate(id)}
          onClear={() => deactivateDate()}
          label="Cleanup"
          emptyLabel={dropdownEmptyLabel}
          disabled={!config.dropdownsEnabled}
        />
      </div>

      <div
        ref={filterRef}
        className={`filter-zone${!anyFilterEnabled ? ' filter-zone--disabled' : ''}`}
        title={anyFilterEnabled ? 'Narrows what data you see on this page' : 'Not applicable on this page'}
      >
        <div className="filter-group">
          <button
            className={`context-my-chip${effectiveMyFilter ? ' context-my-chip--active' : ''}`}
            onClick={() => config.myEnabled && setMyFilter(!myFilter)}
            disabled={!config.myEnabled}
          >
            My
          </button>
        </div>

        <div className="filter-group filter-group--separated">
          <div className="context-pickup-chips">
            {PICKED_UP_PRESETS.map(({ value, label }) => (
              <button
                key={value}
                className={`context-date-chip${pickedUpFilter === value ? ' context-date-chip--active' : ''}`}
                onClick={() => setPickedUpFilter(value)}
                disabled={!config.pickedUpEnabled}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group filter-group--separated">
          <div className="context-date-chips">
            {DATE_PRESETS.map(({ value, label }) => (
              <button
                key={value}
                className={`context-date-chip${datePreset === value ? ' context-date-chip--active' : ''}`}
                onClick={() => setDatePreset(value)}
                disabled={!config.dateEnabled}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {anyFiltersActive && (
          <button
            className={`context-clear-button${user.active_team_id || user.active_cleanup_date_id ? ' context-clear-button--highlight' : ''}`}
            onClick={() => {
              clearFilters()
              if (user.active_team_id) deactivateTeam()
              if (user.active_cleanup_date_id) deactivateDate()
            }}
            title="Clear all filters"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" />
            </svg>
          </button>
        )}
      </div>

      {showCompoundSummary && (
        <div className="context-filter-summary">My picks in {teamName}</div>
      )}
    </div>
  )
}
