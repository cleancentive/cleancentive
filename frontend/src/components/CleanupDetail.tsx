import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { v7 as uuidv7 } from 'uuid'
import { useCleanupStore } from '../stores/cleanupStore'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { LocationPicker } from './LocationPicker'
import { MemberList } from './MemberList'
import { MessageBoard } from './MessageBoard'
import { useUiStore } from '../stores/uiStore'
import { ConfirmDialog } from './ConfirmDialog'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDateRange(startIso: string, endIso: string): string {
  const s = new Date(startIso)
  const e = new Date(endIso)
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate()
  if (sameDay) {
    const day = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    const startTime = s.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const endTime = e.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    return `${day}, ${startTime} – ${endTime}`
  }
  return `${formatDate(startIso)} – ${formatDate(endIso)}`
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultStartFor(referenceDate?: string): string {
  const today = toDatetimeLocal(new Date().toISOString()).split('T')[0]
  const date = referenceDate ? referenceDate.split('T')[0] : today
  if (date === today) {
    return toDatetimeLocal(new Date().toISOString())
  }
  return date + 'T09:00'
}

function defaultEndFrom(startAt: string): string {
  if (!startAt) return ''
  return startAt.split('T')[0] + 'T17:00'
}

function durationHours(startAt: string, endAt: string): number | null {
  if (!startAt || !endAt) return null
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime()
  return ms / (1000 * 60 * 60)
}

function isOngoing(startAt: string, endAt: string): boolean {
  const now = Date.now()
  return new Date(startAt).getTime() <= now && now <= new Date(endAt).getTime()
}

type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

function addOffset(date: Date, frequency: Frequency): Date {
  const d = new Date(date)
  switch (frequency) {
    case 'weekly': d.setDate(d.getDate() + 7); break
    case 'biweekly': d.setDate(d.getDate() + 14); break
    case 'monthly': d.setMonth(d.getMonth() + 1); break
    case 'quarterly': d.setMonth(d.getMonth() + 3); break
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break
  }
  return d
}

function generateRecurringDates(startAt: string, endAt: string, frequency: Frequency, count: number): Array<{ startAt: string; endAt: string }> {
  const results: Array<{ startAt: string; endAt: string }> = []
  let s = new Date(startAt)
  let e = new Date(endAt)
  for (let i = 0; i < count; i++) {
    results.push({ startAt: s.toISOString(), endAt: e.toISOString() })
    s = addOffset(s, frequency)
    e = addOffset(e, frequency)
  }
  return results
}

// Assign distinct hue per recurrence_id
function recurrenceColor(index: number, total: number): string {
  const hue = (index * 360 / Math.max(total, 1)) % 360
  return `hsl(${hue}, 70%, 55%)`
}

export function CleanupDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const { openSignInModal } = useUiStore()
  const {
    currentCleanup,
    messages,
    isLoading,
    isLoadingMessages,
    error,
    fetchCleanup,
    joinCleanup,
    leaveCleanup,
    activateDate,
    deactivateDate,
    addDate,
    addDatesBulk,
    updateCleanup,
    updateDate,
    deleteDate,
    deleteDatesBulk,
    promoteParticipant,
    archiveCleanup,
    fetchMessages,
    postMessage,
    clearError,
  } = useCleanupStore()

  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [deleteDateId, setDeleteDateId] = useState<string | null>(null)
  const [showAddDate, setShowAddDate] = useState(false)
  const [editDateId, setEditDateId] = useState<string | null>(null)
  const [formStartAt, setFormStartAt] = useState('')
  const [formEndAt, setFormEndAt] = useState('')
  const [formLocationName, setFormLocationName] = useState('')
  const [formLat, setFormLat] = useState('')
  const [formLon, setFormLon] = useState('')

  // Repeat
  const [repeatEnabled, setRepeatEnabled] = useState(false)
  const [repeatFrequency, setRepeatFrequency] = useState<Frequency>('weekly')
  const [repeatCount, setRepeatCount] = useState(4)

  // Selection
  const [selectedDateIds, setSelectedDateIds] = useState<Set<string>>(new Set())
  const [hoveredRecurrenceId, setHoveredRecurrenceId] = useState<string | null>(null)

  useEffect(() => {
    if (id) fetchCleanup(id)
  }, [id, fetchCleanup])

  useEffect(() => {
    if (id && currentCleanup?.userRole) {
      fetchMessages(id)
    }
  }, [id, currentCleanup?.userRole, fetchMessages])

  const toggleSelect = useCallback((dateId: string) => {
    setSelectedDateIds((prev) => {
      const next = new Set(prev)
      if (next.has(dateId)) next.delete(dateId)
      else next.add(dateId)
      return next
    })
  }, [])

  if (isLoading) {
    return <div className="community-detail"><p className="loading">Loading...</p></div>
  }

  if (error || !currentCleanup) {
    return (
      <div className="community-detail">
        <p className="error-text">{error || 'Cleanup not found'}</p>
        <Link to="/cleanups" className="back-link">&larr; Back to cleanups</Link>
      </div>
    )
  }

  const { cleanup, participants, userRole } = currentCleanup
  const dates = [...currentCleanup.dates].sort((a, b) => a.start_at.localeCompare(b.start_at))
  const isParticipant = userRole !== null
  const isOrganizer = userRole === 'organizer'
  const activeCleanupDateId = (user as any)?.active_cleanup_date_id

  // Build recurrence color map
  const recurrenceIds = [...new Set(dates.map((d) => d.recurrence_id).filter(Boolean))] as string[]
  const recurrenceColorMap = new Map(recurrenceIds.map((rid, i) => [rid, recurrenceColor(i, recurrenceIds.length)]))

  const handleJoin = () => { if (id) joinCleanup(id) }
  const handleLeave = () => { if (id) leaveCleanup(id) }
  const handleArchive = async () => {
    if (id) {
      await archiveCleanup(id)
      navigate('/cleanups')
    }
  }

  const resetForm = () => {
    setFormStartAt('')
    setFormEndAt('')
    setFormLocationName('')
    setFormLat('')
    setFormLon('')
    setRepeatEnabled(false)
    setRepeatFrequency('weekly')
    setRepeatCount(4)
  }

  const handleAddDate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    if (repeatEnabled && repeatCount > 1) {
      const generated = generateRecurringDates(formStartAt, formEndAt, repeatFrequency, repeatCount)
      await addDatesBulk(id, uuidv7(), generated.map((g) => ({
        startAt: g.startAt,
        endAt: g.endAt,
        latitude: Number(formLat),
        longitude: Number(formLon),
        locationName: formLocationName.trim() || undefined,
      })))
    } else {
      await addDate(id, {
        startAt: formStartAt,
        endAt: formEndAt,
        latitude: Number(formLat),
        longitude: Number(formLon),
        locationName: formLocationName.trim() || undefined,
      })
    }
    setShowAddDate(false)
    resetForm()
  }

  const startEdit = (d: { id: string; start_at: string; end_at: string; latitude: number; longitude: number; location_name: string | null }) => {
    setEditDateId(d.id)
    setShowAddDate(false)
    setFormStartAt(toDatetimeLocal(d.start_at))
    setFormEndAt(toDatetimeLocal(d.end_at))
    setFormLat(String(d.latitude))
    setFormLon(String(d.longitude))
    setFormLocationName(d.location_name || '')
  }

  const handleUpdateDate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editDateId) return
    await updateDate(editDateId, {
      startAt: formStartAt,
      endAt: formEndAt,
      latitude: Number(formLat),
      longitude: Number(formLon),
      locationName: formLocationName.trim() || undefined,
    })
    setEditDateId(null)
    resetForm()
  }

  const handleDeleteDate = async () => {
    if (!id || !deleteDateId) return
    await deleteDate(id, deleteDateId)
    setDeleteDateId(null)
  }

  const handleBulkDelete = async () => {
    if (!id || selectedDateIds.size === 0) return
    await deleteDatesBulk(id, [...selectedDateIds])
    setSelectedDateIds(new Set())
    setShowBulkDeleteConfirm(false)
  }

  // Quick-select helpers
  const selectRelated = () => {
    const selectedRecurrenceIds = new Set(
      dates.filter((d) => selectedDateIds.has(d.id) && d.recurrence_id).map((d) => d.recurrence_id!)
    )
    if (selectedRecurrenceIds.size === 0) return
    setSelectedDateIds((prev) => {
      const next = new Set(prev)
      for (const d of dates) {
        if (d.recurrence_id && selectedRecurrenceIds.has(d.recurrence_id)) next.add(d.id)
      }
      return next
    })
  }

  const selectAllAfter = () => {
    const selectedDates = dates.filter((d) => selectedDateIds.has(d.id))
    if (selectedDates.length === 0) return
    const earliest = selectedDates.reduce((a, b) => a.start_at < b.start_at ? a : b)
    setSelectedDateIds((prev) => {
      const next = new Set(prev)
      for (const d of dates) {
        if (d.start_at >= earliest.start_at) next.add(d.id)
      }
      return next
    })
  }

  const hasSelectedWithRecurrence = dates.some((d) => selectedDateIds.has(d.id) && d.recurrence_id)
  const earliestSelected = selectedDateIds.size > 0
    ? dates.filter((d) => selectedDateIds.has(d.id)).reduce((a, b) => a.start_at < b.start_at ? a : b, dates[0])
    : null

  // Preview for repeat
  const repeatPreview = repeatEnabled && formStartAt && formEndAt
    ? generateRecurringDates(formStartAt, formEndAt, repeatFrequency, repeatCount)
    : []

  const nowLocal = toDatetimeLocal(new Date().toISOString())

  const dateForm = (
    onSubmit: (e: React.FormEvent) => void,
    submitLabel: string,
    onCancel: () => void,
    showRepeat = false,
  ) => (
    <form className="community-create-form" onSubmit={onSubmit}>
      <div className="form-row">
        <div className="form-group">
          <label>Start</label>
          <input
            type="datetime-local"
            value={formStartAt}
            min={nowLocal}
            onChange={(e) => setFormStartAt(e.target.value)}
            onFocus={() => { if (!formStartAt) setFormStartAt(defaultStartFor(formEndAt || undefined)) }}
            required
          />
        </div>
        <div className="form-group">
          <label>End</label>
          <input
            type="datetime-local"
            value={formEndAt}
            min={formStartAt || nowLocal}
            onChange={(e) => { if (formStartAt && e.target.value < formStartAt) return; setFormEndAt(e.target.value) }}
            onFocus={() => { if (!formEndAt) setFormEndAt(formStartAt ? defaultEndFrom(formStartAt) : '') }}
            required
          />
        </div>
      </div>
      {(() => {
        const hours = durationHours(formStartAt, formEndAt)
        return hours !== null && hours > 0 && hours < 2 ? (
          <p className="form-warning">Duration is less than 2 hours. Are you sure?</p>
        ) : null
      })()}

      {showRepeat && (
        <div className="repeat-section">
          <label className="repeat-toggle">
            <input type="checkbox" checked={repeatEnabled} onChange={(e) => setRepeatEnabled(e.target.checked)} />
            Repeat
          </label>
          {repeatEnabled && (
            <div className="repeat-options">
              <label>
                Frequency
                <select value={repeatFrequency} onChange={(e) => setRepeatFrequency(e.target.value as Frequency)}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label>
                Occurrences
                <input type="number" min={2} max={52} value={repeatCount} onChange={(e) => setRepeatCount(Math.min(52, Math.max(2, Number(e.target.value))))} />
              </label>
            </div>
          )}
          {repeatPreview.length > 1 && (
            <div className="repeat-preview">
              <strong>{repeatPreview.length} dates:</strong>
              <ul>
                {repeatPreview.map((p, i) => (
                  <li key={i}>{formatDateRange(p.startAt, p.endAt)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <LocationPicker
        latitude={formLat}
        longitude={formLon}
        locationName={formLocationName}
        onLatitudeChange={setFormLat}
        onLongitudeChange={setFormLon}
        onLocationNameChange={setFormLocationName}
      />
      <div className="community-actions">
        <button type="submit" className="primary-button" disabled={!isOnline}>
          {submitLabel}{repeatEnabled && repeatPreview.length > 1 ? ` (${repeatPreview.length})` : ''}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )

  return (
    <div className="community-detail">
      <Link to="/cleanups" className="back-link">&larr; Back to cleanups</Link>

      <fieldset className="page-card">
        {editing ? (
          <div className="community-edit-form">
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
            </div>
            <div className="community-actions">
              <button className="primary-button" disabled={!editName.trim() || !isOnline} onClick={async () => {
                if (!id) return
                await updateCleanup(id, { name: editName, description: editDescription })
                setEditing(false)
              }}>Save</button>
              <button className="secondary-button" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <legend>
              {cleanup.name}
              {isOrganizer && <button className="link-button legend-edit-button" onClick={() => { setEditName(cleanup.name); setEditDescription(cleanup.description); setEditing(true) }}>Edit</button>}
            </legend>
            {cleanup.description && <p>{cleanup.description}</p>}
          </>
        )}

        {error && (
          <div className="error-message">
            {error}
            <button onClick={clearError}>&times;</button>
          </div>
        )}

        {!user && (
          <div className="community-guest-cta">
            <span>Sign in to join this cleanup</span>
            <button className="sign-in-cta-button" onClick={openSignInModal}>Sign In</button>
          </div>
        )}

        {user && !isParticipant && (
          <button className="primary-button" onClick={handleJoin} disabled={!isOnline}>
            Join Cleanup
          </button>
        )}

        {user && isParticipant && (
          <div className="community-actions">
            <button className="danger-button" onClick={handleLeave} disabled={!isOnline}>
              Leave Cleanup
            </button>
          </div>
        )}

        {isOrganizer && (
          <div className="community-admin-actions">
            <h3>Organizer Actions</h3>
            <button
              className="danger-button"
              onClick={() => setShowArchiveConfirm(true)}
              disabled={!isOnline}
              title="Hides the cleanup from search and prevents new activity. Existing data is preserved."
            >
              Archive Cleanup
            </button>
          </div>
        )}
      </fieldset>

      <fieldset className="page-card">
        <legend>Dates ({dates.length})</legend>
        {dates.length === 0 && <p className="end-of-list">No dates scheduled</p>}

        {isOrganizer && selectedDateIds.size > 0 && (
          <div className="bulk-actions">
            {hasSelectedWithRecurrence && (
              <button className="secondary-button" onClick={selectRelated}>Select related dates</button>
            )}
            {earliestSelected && (
              <button className="secondary-button" onClick={selectAllAfter}>
                Select all after {formatShortDate(earliestSelected.start_at)}
              </button>
            )}
            <button className="danger-button" onClick={() => setShowBulkDeleteConfirm(true)} disabled={!isOnline}>
              Delete {selectedDateIds.size} date{selectedDateIds.size > 1 ? 's' : ''}
            </button>
            <button className="link-button" onClick={() => setSelectedDateIds(new Set())}>Clear selection</button>
          </div>
        )}

        {dates.map((d) => {
          const ongoing = isOngoing(d.start_at, d.end_at)
          const isActive = activeCleanupDateId === d.id
          const isEditing = editDateId === d.id
          const borderColor = d.recurrence_id ? recurrenceColorMap.get(d.recurrence_id) : undefined
          const isGlowing = d.recurrence_id !== null && d.recurrence_id === hoveredRecurrenceId
          const isSelected = selectedDateIds.has(d.id)

          if (isEditing) {
            return (
              <div key={d.id}>
                {dateForm(handleUpdateDate, 'Save', () => { setEditDateId(null); resetForm() })}
              </div>
            )
          }

          return (
            <div
              key={d.id}
              className={`cleanup-date-card ${ongoing ? 'cleanup-date-card--ongoing' : ''} ${isSelected ? 'cleanup-date-card--selected' : ''} ${isGlowing ? 'cleanup-date-card--glow' : ''}`}
              style={{
                borderLeftWidth: borderColor ? '4px' : undefined,
                borderLeftColor: borderColor,
                '--recurrence-color': borderColor || 'transparent',
              } as React.CSSProperties}
              onMouseEnter={() => { if (d.recurrence_id) setHoveredRecurrenceId(d.recurrence_id) }}
              onMouseLeave={() => { if (d.recurrence_id === hoveredRecurrenceId) setHoveredRecurrenceId(null) }}
              onDoubleClick={() => {
                if (!isOrganizer) return
                if (d.recurrence_id) {
                  const relatedIds = dates.filter((x) => x.recurrence_id === d.recurrence_id).map((x) => x.id)
                  const allSelected = relatedIds.every((rid) => selectedDateIds.has(rid))
                  setSelectedDateIds((prev) => {
                    const next = new Set(prev)
                    for (const rid of relatedIds) { allSelected ? next.delete(rid) : next.add(rid) }
                    return next
                  })
                } else {
                  toggleSelect(d.id)
                }
              }}
            >
              {isOrganizer && (
                <input
                  type="checkbox"
                  className="date-select-checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(d.id)}
                />
              )}
              <div className="cleanup-date-info">
                <strong>{formatDateRange(d.start_at, d.end_at)}</strong>
                {d.location_name && <span className="cleanup-date-location"> · {d.location_name}</span>}
                {ongoing && <span className="badge">Ongoing</span>}
                {isActive && <span className="badge admin-badge">Active</span>}
              </div>
              <div className="cleanup-date-actions">
                {isParticipant && ongoing && !isActive && (
                  <button className="secondary-button" onClick={() => activateDate(d.id)} disabled={!isOnline}>
                    Activate
                  </button>
                )}
                {isParticipant && isActive && (
                  <button className="secondary-button" onClick={() => deactivateDate()} disabled={!isOnline}>
                    Deactivate
                  </button>
                )}
                {isOrganizer && (
                  <>
                    <button className="link-button" onClick={() => startEdit(d)}>Edit</button>
                    <button className="link-button danger-text" onClick={() => setDeleteDateId(d.id)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          )
        })}

        {isOrganizer && (
          <>
            <button className="link-button" onClick={() => { setShowAddDate(!showAddDate); setEditDateId(null); if (!showAddDate) resetForm() }}>
              {showAddDate ? 'Cancel' : '+ Add date'}
            </button>
            {showAddDate && dateForm(handleAddDate, 'Add Date', () => { setShowAddDate(false); resetForm() }, true)}
          </>
        )}
      </fieldset>

      <fieldset className="page-card">
        <legend>Participants ({participants.length})</legend>
        <MemberList
          members={participants}
          canPromote={isOrganizer}
          onPromote={(userId) => id && promoteParticipant(id, userId)}
          entityLabel="Participant"
        />
      </fieldset>

      {isParticipant && (
        <fieldset className="page-card">
          <legend>Messages</legend>
          <MessageBoard
            messages={messages}
            onPost={(audience, subject, body) => postMessage(id!, audience, subject, body)}
            canPost={isParticipant}
            isOrganizer={isOrganizer}
            isLoading={isLoadingMessages}
          />
        </fieldset>
      )}

      {showArchiveConfirm && (
        <ConfirmDialog
          title="Archive Cleanup"
          actions={
            <>
              <button className="secondary-button" onClick={() => setShowArchiveConfirm(false)}>Cancel</button>
              <button className="danger-button" onClick={handleArchive}>Archive</button>
            </>
          }
        >
          <p>Are you sure you want to archive <strong>{cleanup.name}</strong>? This will deactivate the cleanup for all participants.</p>
        </ConfirmDialog>
      )}

      {deleteDateId && (
        <ConfirmDialog
          title="Delete Date"
          actions={
            <>
              <button className="secondary-button" onClick={() => setDeleteDateId(null)}>Cancel</button>
              <button className="danger-button" onClick={handleDeleteDate}>Delete</button>
            </>
          }
        >
          <p>Are you sure you want to delete this date? Users with this date active will be deactivated.</p>
        </ConfirmDialog>
      )}

      {showBulkDeleteConfirm && (
        <ConfirmDialog
          title="Delete Dates"
          actions={
            <>
              <button className="secondary-button" onClick={() => setShowBulkDeleteConfirm(false)}>Cancel</button>
              <button className="danger-button" onClick={handleBulkDelete}>Delete {selectedDateIds.size} date{selectedDateIds.size > 1 ? 's' : ''}</button>
            </>
          }
        >
          <p>Are you sure you want to delete <strong>{selectedDateIds.size}</strong> date{selectedDateIds.size > 1 ? 's' : ''}? Users with these dates active will be deactivated.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
