import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useCleanupStore } from '../stores/cleanupStore'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useInsightsFilterStore } from '../stores/insightsFilterStore'
import { CommunityList } from './CommunityList'
import { CommunityCard } from './CommunityCard'
import { LocationPicker } from './LocationPicker'
import { ProfileHintBanner } from './ProfileHintBanner'
import { isoToDatetimeLocal } from '../utils/datetime'

function defaultStartFor(referenceDate?: string): string {
  const today = isoToDatetimeLocal(new Date().toISOString()).split('T')[0]
  const date = referenceDate ? referenceDate.split('T')[0] : today
  if (date === today) {
    // Today: use current time (don't default to 9am in the past)
    return isoToDatetimeLocal(new Date().toISOString())
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
  { value: 'ongoing' as const },
  { value: 'future' as const },
  { value: 'past' as const },
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
  const { t } = useTranslation(['cleanups', 'common'])
  const { user } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const { cleanups, cleanupCounts, statusFilter, isLoading, error, searchCleanups, createCleanup, toggleStatusFilter, clearError } = useCleanupStore()
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

  const handleStatusToggle = (status: 'past' | 'ongoing' | 'future') => {
    toggleStatusFilter(status)
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

  const visibleCleanups = cleanups.filter(c => {
    if (myFilter && c.userRole === null) return false
    if (activeCleanupDateId && c.nearestDate?.id !== activeCleanupDateId) return false
    return true
  })

  return (
    <CommunityList
      title={t('cleanups:list.title')}
      count={visibleCleanups.length}
      searchPlaceholder={t('cleanups:list.searchPlaceholder')}
      onSearchChange={handleSearch}
      isLoading={isLoading}
      error={error}
      hideSearch={showCreate}
      onClearError={clearError}
      emptyMessage={t('cleanups:list.empty')}
      isEmpty={visibleCleanups.length === 0}
      actions={
        user && (
          <button className="primary-button" onClick={handleToggleCreate}>
            {showCreate ? t('common:actions.cancel') : t('cleanups:list.create')}
          </button>
        )
      }
      filters={
        <div className="status-filter-pills">
          {STATUS_OPTIONS.map((opt) => {
            const count = cleanupCounts?.[opt.value]
            return (
              <button
                key={opt.value}
                className={`filter-pill ${statusFilter.has(opt.value) ? 'filter-pill--active' : ''}`}
                onClick={() => handleStatusToggle(opt.value)}
              >
                {t(`cleanups:list.status.${opt.value}`)}{count != null ? ` (${count})` : ''}
              </button>
            )
          })}
        </div>
      }
    >
      {showCreate && (
        <form className="community-create-form" onSubmit={handleCreate}>
          <ProfileHintBanner surface="cleanup-create" />
          <div className="form-group">
            <label htmlFor="cleanup-name">{t('cleanups:createForm.nameLabel')}</label>
            <input id="cleanup-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cleanups:createForm.namePlaceholder')} required />
          </div>
          <div className="form-group">
            <label htmlFor="cleanup-description">{t('cleanups:createForm.descriptionLabel')}</label>
            <textarea id="cleanup-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('cleanups:createForm.descriptionPlaceholder')} rows={10} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="cleanup-start">{t('cleanups:createForm.startLabel')}</label>
              <input
                id="cleanup-start"
                type="datetime-local"
                value={startAt}
                min={isoToDatetimeLocal(new Date().toISOString())}
                onChange={(e) => setStartAt(e.target.value)}
                onFocus={() => { if (!startAt) setStartAt(defaultStartFor(endAt || undefined)) }}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="cleanup-end">{t('cleanups:createForm.endLabel')}</label>
              <input
                id="cleanup-end"
                type="datetime-local"
                value={endAt}
                min={startAt || isoToDatetimeLocal(new Date().toISOString())}
                onChange={(e) => { if (startAt && new Date(e.target.value) < new Date(startAt)) return; setEndAt(e.target.value) }}
                onFocus={() => { if (!endAt) setEndAt(startAt ? defaultEndFrom(startAt) : '') }}
                required
              />
            </div>
          </div>
          {(() => {
            const hours = durationHours(startAt, endAt)
            return hours !== null && hours > 0 && hours < 2 ? (
              <p className="form-warning">{t('cleanups:createForm.shortDurationWarning')}</p>
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
            {isLoading ? t('cleanups:createForm.creating') : t('cleanups:createForm.submit')}
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
                {userRole && <span className={`badge ${userRole === 'admin' ? 'admin-badge' : ''}`}>{userRole === 'organizer' ? t('common:domain.organizer') : userRole === 'member' ? t('cleanups:members.roleMember') : userRole}</span>}
                {isActive && <span className="badge" style={{ background: 'var(--color-badge-active)' }}>{t('cleanups:list.badge.active')}</span>}
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
