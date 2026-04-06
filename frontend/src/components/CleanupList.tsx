import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCleanupStore } from '../stores/cleanupStore'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useInsightsFilterStore } from '../stores/insightsFilterStore'
import { CommunityList } from './CommunityList'
import { CommunityCard } from './CommunityCard'
import { LocationPicker } from './LocationPicker'

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultStartFor(referenceDate?: string): string {
  const today = toDatetimeLocal(new Date().toISOString()).split('T')[0]
  const date = referenceDate ? referenceDate.split('T')[0] : today
  if (date === today) {
    // Today: use current time (don't default to 9am in the past)
    return toDatetimeLocal(new Date().toISOString())
  }
  return date + 'T09:00'
}

function defaultEndFrom(startAt: string): string {
  if (!startAt) return ''
  // Same date at 17:00
  return startAt.split('T')[0] + 'T17:00'
}

function durationHours(startAt: string, endAt: string): number | null {
  if (!startAt || !endAt) return null
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime()
  return ms / (1000 * 60 * 60)
}

const STATUS_OPTIONS = [
  { value: null, label: 'All' },
  { value: 'ongoing' as const, label: 'Ongoing' },
  { value: 'future' as const, label: 'Future' },
  { value: 'past' as const, label: 'Past' },
]

function formatDateRange(startAt: string, endAt: string): string {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  if (start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString(undefined, opts)
  }
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`
}

export function CleanupList() {
  const { user } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const { cleanups, statusFilter, isLoading, error, searchCleanups, createCleanup, setStatusFilter, clearError } = useCleanupStore()
  const { myFilter } = useInsightsFilterStore()
  const navigate = useNavigate()
  const activeCleanupDateId = (user as any)?.active_cleanup_date_id as string | null

  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [locationName, setLocationName] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')

  useEffect(() => {
    searchCleanups()
  }, [searchCleanups, statusFilter])

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    searchCleanups(q)
  }

  const handleToggleCreate = () => {
    if (!showCreate) {
      setName(searchQuery)
    }
    setShowCreate(!showCreate)
  }

  const handleStatusChange = (status: 'past' | 'ongoing' | 'future' | null) => {
    setStatusFilter(status)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanup = await createCleanup(name.trim(), description.trim(), {
      startAt,
      endAt,
      latitude: Number(latitude),
      longitude: Number(longitude),
      locationName: locationName.trim() || undefined,
    })
    if (cleanup) {
      setShowCreate(false)
      setName('')
      setDescription('')
      setStartAt('')
      setEndAt('')
      setLocationName('')
      setLatitude('')
      setLongitude('')
      navigate(`/cleanups/${cleanup.id}`)
    }
  }

  return (
    <CommunityList
      title="Cleanups"
      searchPlaceholder="Search cleanups..."
      onSearchChange={handleSearch}
      isLoading={isLoading}
      error={error}
      hideSearch={showCreate}
      onClearError={clearError}
      emptyMessage="No cleanups found"
      isEmpty={cleanups.filter(c => {
        if (myFilter && c.userRole === null) return false
        if (activeCleanupDateId && c.nearestDate?.id !== activeCleanupDateId) return false
        return true
      }).length === 0}
      actions={
        user && (
          <button className="primary-button" onClick={handleToggleCreate}>
            {showCreate ? 'Cancel' : 'Create Cleanup'}
          </button>
        )
      }
      filters={
        <div className="status-filter-pills">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              className={`filter-pill ${statusFilter === opt.value ? 'filter-pill--active' : ''}`}
              onClick={() => handleStatusChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      }
    >
      {showCreate && (
        <form className="community-create-form" onSubmit={handleCreate}>
          <div className="form-group">
            <label htmlFor="cleanup-name">Name</label>
            <input id="cleanup-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Saturday Park Cleanup" required />
          </div>
          <div className="form-group">
            <label htmlFor="cleanup-description">Description</label>
            <textarea id="cleanup-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this cleanup about?" rows={10} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="cleanup-start">Start</label>
              <input
                id="cleanup-start"
                type="datetime-local"
                value={startAt}
                min={toDatetimeLocal(new Date().toISOString())}
                onChange={(e) => setStartAt(e.target.value)}
                onFocus={() => { if (!startAt) setStartAt(defaultStartFor(endAt || undefined)) }}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="cleanup-end">End</label>
              <input
                id="cleanup-end"
                type="datetime-local"
                value={endAt}
                min={startAt || toDatetimeLocal(new Date().toISOString())}
                onChange={(e) => { if (startAt && e.target.value < startAt) return; setEndAt(e.target.value) }}
                onFocus={() => { if (!endAt) setEndAt(startAt ? defaultEndFrom(startAt) : '') }}
                required
              />
            </div>
          </div>
          {(() => {
            const hours = durationHours(startAt, endAt)
            return hours !== null && hours > 0 && hours < 2 ? (
              <p className="form-warning">Duration is less than 2 hours. Are you sure?</p>
            ) : null
          })()}
          <LocationPicker
            latitude={latitude}
            longitude={longitude}
            locationName={locationName}
            onLatitudeChange={setLatitude}
            onLongitudeChange={setLongitude}
            onLocationNameChange={setLocationName}
          />
          <button type="submit" className="primary-button" disabled={isLoading || !isOnline}>
            {isLoading ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {cleanups.filter(c => {
        if (myFilter && c.userRole === null) return false
        if (activeCleanupDateId && c.nearestDate?.id !== activeCleanupDateId) return false
        return true
      }).map(({ cleanup, nearestDate, userRole }) => {
        const isActive = nearestDate && activeCleanupDateId === nearestDate.id
        return (
          <CommunityCard
            key={cleanup.id}
            to={`/cleanups/${cleanup.id}`}
            title={cleanup.name}
            description={cleanup.description}
            tags={
              <>
                {userRole && <span className={`badge ${userRole === 'admin' ? 'admin-badge' : ''}`}>{userRole}</span>}
                {isActive && <span className="badge" style={{ background: 'var(--color-badge-active)' }}>Active</span>}
              </>
            }
            meta={nearestDate && (
              <>
                <span>{formatDateRange(nearestDate.start_at, nearestDate.end_at)}</span>
                {nearestDate.location_name && <span> · {nearestDate.location_name}</span>}
              </>
            )}
          />
        )
      })}
    </CommunityList>
  )
}
