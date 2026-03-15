import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useTeamStore } from '../stores/teamStore'
import { useCleanupStore } from '../stores/cleanupStore'
import { useConnectivityStore } from '../stores/connectivityStore'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  )
}

function Dropdown({ items, activeId, onSelect, onClear, label }: {
  items: Array<{ id: string; name: string }>
  activeId: string | null
  onSelect: (id: string) => void
  onClear: () => void
  label: string
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

  return (
    <div className="context-dropdown" ref={ref}>
      <button className="context-dropdown-trigger" onClick={() => setOpen(!open)}>
        <span className="context-dropdown-label">{label}:</span>
        <span className="context-dropdown-value">{activeName || 'None'}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="context-dropdown-menu">
          <button
            className={`context-dropdown-item ${!activeId ? 'context-dropdown-item--active' : ''}`}
            onClick={() => { onClear(); setOpen(false) }}
          >
            None
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

export function ContextBar() {
  const { user } = useAuthStore()
  const { teams, searchTeams, activateTeam, deactivateTeam } = useTeamStore()
  const { cleanups, searchCleanups, activateDate, deactivateDate } = useCleanupStore()
  const { isOnline } = useConnectivityStore()
  const autoActivatedRef = useRef<string | null>(null)

  const refreshData = useCallback(() => {
    if (!user) return
    searchTeams()
    searchCleanups()
  }, [user, searchTeams, searchCleanups])

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

  // Compute eligible cleanups: only ongoing dates when online, all when offline
  const myCleanups = cleanups
    .filter(c => c.userRole !== null && c.nearestDate)
    .filter(c => {
      if (!isOnline) return true
      const d = c.nearestDate!
      return isDateOngoing(d.start_at, d.end_at)
    })
    .map(c => ({ id: c.nearestDate!.id, name: c.cleanup.name }))

  // Auto-activate if exactly one ongoing cleanup and none currently active
  useEffect(() => {
    if (!user || !isOnline) return
    if (myCleanups.length === 1 && !user.active_cleanup_date_id) {
      const candidate = myCleanups[0].id
      if (autoActivatedRef.current !== candidate) {
        autoActivatedRef.current = candidate
        activateDate(candidate)
      }
    }
  }, [myCleanups.length, myCleanups[0]?.id, user?.active_cleanup_date_id, isOnline, activateDate, user])

  if (!user) return null

  // Only show teams the user is a member of
  const myTeams = teams
    .filter(t => t.userRole !== null)
    .map(t => ({ id: t.team.id, name: t.team.name }))

  return (
    <div className="context-bar">
      <Dropdown
        items={myTeams}
        activeId={user.active_team_id || null}
        onSelect={(id) => activateTeam(id)}
        onClear={() => deactivateTeam()}
        label="Team"
      />
      <Dropdown
        items={myCleanups}
        activeId={user.active_cleanup_date_id || null}
        onSelect={(id) => activateDate(id)}
        onClear={() => deactivateDate()}
        label="Cleanup"
      />
    </div>
  )
}
