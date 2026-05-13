import { useEffect, useState } from 'react'
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
import { formatDateRange } from '../utils/datetime'
import { type Frequency, isOngoing, recurrenceColor } from '../lib/cleanupDates'
import { useCleanupSelection } from '../hooks/useCleanupSelection'
import { useCleanupDateForm } from '../hooks/useCleanupDateForm'
import { DateCard } from './cleanup/DateCard'
import { BulkDateActions } from './cleanup/BulkDateActions'
import { CleanupCalendarSection } from './cleanup/CleanupCalendarSection'

export function CleanupDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, getCalendarUrls } = useAuthStore()
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
  const form = useCleanupDateForm()

  // Selection
  const [hoveredRecurrenceId, setHoveredRecurrenceId] = useState<string | null>(null)
  const [joinedWebcal, setJoinedWebcal] = useState<string | null>(null)

  useEffect(() => {
    if (id) fetchCleanup(id)
  }, [id, fetchCleanup])

  useEffect(() => {
    if (!user) { setJoinedWebcal(null); return }
    let cancelled = false
    getCalendarUrls().then((urls) => {
      if (!cancelled) setJoinedWebcal(urls?.joinedWebcal ?? null)
    })
    return () => { cancelled = true }
  }, [user?.id, getCalendarUrls])

  useEffect(() => {
    if (id && currentCleanup?.userRole) {
      fetchMessages(id)
    }
  }, [id, currentCleanup?.userRole, fetchMessages])

  // Hooks must run unconditionally — compute `dates` (possibly empty) before any early return.
  const dates = currentCleanup
    ? [...currentCleanup.dates].sort((a, b) => a.start_at.localeCompare(b.start_at))
    : []

  const {
    selectedDateIds,
    toggleSelect,
    toggleRecurrenceGroup,
    selectRelated,
    selectAllAfter,
    clearSelection,
    hasSelectedWithRecurrence,
    earliestSelected,
  } = useCleanupSelection(dates)

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

  const handleAddDate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    if (form.repeatEnabled && form.repeatCount > 1) {
      await addDatesBulk(id, uuidv7(), form.repeatPreview.map((g) => ({
        startAt: g.startAt,
        endAt: g.endAt,
        latitude: Number(form.lat),
        longitude: Number(form.lon),
        locationName: form.locationName.trim() || undefined,
      })))
    } else {
      await addDate(id, {
        startAt: form.startAt,
        endAt: form.endAt,
        latitude: Number(form.lat),
        longitude: Number(form.lon),
        locationName: form.locationName.trim() || undefined,
      })
    }
    setShowAddDate(false)
    form.reset()
  }

  const startEdit = (d: { id: string; start_at: string; end_at: string; latitude: number; longitude: number; location_name: string | null }) => {
    setEditDateId(d.id)
    setShowAddDate(false)
    form.populateFromDate(d)
  }

  const handleUpdateDate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editDateId) return
    await updateDate(editDateId, {
      startAt: form.startAt,
      endAt: form.endAt,
      latitude: Number(form.lat),
      longitude: Number(form.lon),
      locationName: form.locationName.trim() || undefined,
    })
    setEditDateId(null)
    form.reset()
  }

  const handleDeleteDate = async () => {
    if (!id || !deleteDateId) return
    await deleteDate(id, deleteDateId)
    setDeleteDateId(null)
  }

  const handleBulkDelete = async () => {
    if (!id || selectedDateIds.size === 0) return
    await deleteDatesBulk(id, [...selectedDateIds])
    clearSelection()
    setShowBulkDeleteConfirm(false)
  }

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
            value={form.startAt}
            min={form.nowLocal}
            onChange={(e) => form.setStartAt(e.target.value)}
            onFocus={form.handleStartFocus}
            required
          />
        </div>
        <div className="form-group">
          <label>End</label>
          <input
            type="datetime-local"
            value={form.endAt}
            min={form.startAt || form.nowLocal}
            onChange={(e) => form.handleEndChange(e.target.value)}
            onFocus={form.handleEndFocus}
            required
          />
        </div>
      </div>
      {form.durationHoursValue !== null && form.durationHoursValue > 0 && form.durationHoursValue < 2 ? (
        <p className="form-warning">Duration is less than 2 hours. Are you sure?</p>
      ) : null}

      {showRepeat && (
        <div className="repeat-section">
          <label className="repeat-toggle">
            <input type="checkbox" checked={form.repeatEnabled} onChange={(e) => form.setRepeatEnabled(e.target.checked)} />
            Repeat
          </label>
          {form.repeatEnabled && (
            <div className="repeat-options">
              <label>
                Frequency
                <select value={form.repeatFrequency} onChange={(e) => form.setRepeatFrequency(e.target.value as Frequency)}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label>
                Occurrences
                <input type="number" min={2} max={52} value={form.repeatCount} onChange={(e) => form.setRepeatCount(Number(e.target.value))} />
              </label>
            </div>
          )}
          {form.repeatPreview.length > 1 && (
            <div className="repeat-preview">
              <strong>{form.repeatPreview.length} dates:</strong>
              <ul>
                {form.repeatPreview.map((p, i) => (
                  <li key={i}>{formatDateRange(p.startAt, p.endAt)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <LocationPicker
        latitude={form.lat}
        longitude={form.lon}
        locationName={form.locationName}
        onLatitudeChange={form.setLat}
        onLongitudeChange={form.setLon}
        onLocationNameChange={form.setLocationName}
      />
      <div className="community-actions">
        <button type="submit" className="primary-button" disabled={!isOnline}>
          {submitLabel}{form.repeatEnabled && form.repeatPreview.length > 1 ? ` (${form.repeatPreview.length})` : ''}
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
            {cleanup.description && <p className="cleanup-description-display">{cleanup.description}</p>}
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

        {user && isParticipant && <CleanupCalendarSection joinedWebcal={joinedWebcal} />}

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
          <BulkDateActions
            selectedCount={selectedDateIds.size}
            earliestSelectedStartAt={earliestSelected?.start_at ?? null}
            hasSelectedWithRecurrence={hasSelectedWithRecurrence}
            isOnline={isOnline}
            onSelectRelated={selectRelated}
            onSelectAllAfter={selectAllAfter}
            onRequestBulkDelete={() => setShowBulkDeleteConfirm(true)}
            onClearSelection={clearSelection}
          />
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
                {dateForm(handleUpdateDate, 'Save', () => { setEditDateId(null); form.reset() })}
              </div>
            )
          }

          return (
            <DateCard
              key={d.id}
              date={d}
              isOrganizer={isOrganizer}
              isParticipant={isParticipant}
              isSelected={isSelected}
              ongoing={ongoing}
              isActive={isActive}
              borderColor={borderColor}
              isGlowing={isGlowing}
              isOnline={isOnline}
              onMouseEnter={() => { if (d.recurrence_id) setHoveredRecurrenceId(d.recurrence_id) }}
              onMouseLeave={() => { if (d.recurrence_id === hoveredRecurrenceId) setHoveredRecurrenceId(null) }}
              onDoubleClick={() => { if (isOrganizer) toggleRecurrenceGroup(d.id) }}
              onToggleSelect={() => toggleSelect(d.id)}
              onActivate={() => activateDate(d.id)}
              onDeactivate={() => deactivateDate()}
              onEdit={() => startEdit(d)}
              onDelete={() => setDeleteDateId(d.id)}
            />
          )
        })}

        {isOrganizer && (
          <>
            <button className="link-button" onClick={() => { setShowAddDate(!showAddDate); setEditDateId(null); if (!showAddDate) form.reset() }}>
              {showAddDate ? 'Cancel' : '+ Add date'}
            </button>
            {showAddDate && dateForm(handleAddDate, 'Add Date', () => { setShowAddDate(false); form.reset() }, true)}
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
