import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTeamStore } from '../stores/teamStore'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { MemberList } from './MemberList'
import { MessageBoard } from './MessageBoard'
import { useUiStore } from '../stores/uiStore'
import { ConfirmDialog } from './ConfirmDialog'
import { PartnerSettingsFields } from './PartnerSettingsFields'

export function TeamDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { isAdmin: isPlatformAdmin } = useAdminStore()
  const { isOnline } = useConnectivityStore()
  const { openSignInModal } = useUiStore()
  const {
    currentTeam,
    messages,
    isLoading,
    isLoadingMessages,
    error,
    fetchTeam,
    joinTeam,
    leaveTeam,
    activateTeam,
    deactivateTeam,
    promoteMember,
    updateTeam,
    archiveTeam,
    fetchMessages,
    postMessage,
    updateEmailPatterns,
    updateCustomCss,
    clearError,
  } = useTeamStore()

  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPatterns, setEditPatterns] = useState('')
  const [editCss, setEditCss] = useState('')

  useEffect(() => {
    if (id) fetchTeam(id)
  }, [id, fetchTeam])

  useEffect(() => {
    if (id && currentTeam?.userRole) {
      fetchMessages(id)
    }
  }, [id, currentTeam?.userRole, fetchMessages])

  useEffect(() => {
    if (currentTeam) {
      setEditPatterns(currentTeam.emailPatterns?.map(p => p.email_pattern).join('\n') || '')
      setEditCss(currentTeam.team.custom_css || '')
    }
  }, [currentTeam?.team.id])

  if (isLoading) {
    return <div className="community-detail"><p className="loading">Loading...</p></div>
  }

  if (error || !currentTeam) {
    return (
      <div className="community-detail">
        <p className="error-text">{error || 'Team not found'}</p>
        <Link to="/teams" className="back-link">&larr; Back to teams</Link>
      </div>
    )
  }

  const { team, members, userRole, isPartner } = currentTeam
  const isMember = userRole !== null
  const isOrganizer = userRole === 'organizer'
  const activeTeamId = user?.active_team_id

  const handleJoin = () => { if (id) joinTeam(id) }
  const handleLeave = () => { if (id) leaveTeam(id) }
  const handleActivate = () => { if (id) activateTeam(id) }
  const handleDeactivate = () => { deactivateTeam() }
  const handleArchive = async () => {
    if (id) {
      await archiveTeam(id)
      navigate('/teams')
    }
  }

  return (
    <div className="community-detail">
      <Link to="/teams" className="back-link">&larr; Back to teams</Link>

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
                await updateTeam(id, { name: editName, description: editDescription })
                setEditing(false)
              }}>Save</button>
              <button className="secondary-button" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <legend>
              {team.name}
              {isOrganizer && <button className="link-button legend-edit-button" onClick={() => { setEditName(team.name); setEditDescription(team.description); setEditing(true) }}>Edit</button>}
            </legend>
            {team.description && <p>{team.description}</p>}
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
            <span>Sign in to join this team</span>
            <button className="sign-in-cta-button" onClick={openSignInModal}>Sign In</button>
          </div>
        )}

        {isPartner && (
          <p className="partner-notice">
            <span className="badge" style={{ background: 'var(--color-badge-partner)' }}>Partner</span>
            {' '}Membership is managed automatically based on your email domain.
          </p>
        )}

        {user && !isMember && !isPartner && (
          <button className="primary-button" onClick={handleJoin} disabled={!isOnline}>
            Join Team
          </button>
        )}

        {user && isMember && (
          <div className="community-actions">
            {activeTeamId === team.id ? (
              <button className="secondary-button" onClick={handleDeactivate} disabled={!isOnline}>
                Deactivate Team
              </button>
            ) : (
              <button className="secondary-button" onClick={handleActivate} disabled={!isOnline}>
                Set as Active Team
              </button>
            )}
            {!isPartner && (
              <button className="danger-button" onClick={handleLeave} disabled={!isOnline}>
                Leave Team
              </button>
            )}
          </div>
        )}

        {isOrganizer && (
          <div className="community-admin-actions">
            <h3>Organizer Actions</h3>
            <button
              className="danger-button"
              onClick={() => setShowArchiveConfirm(true)}
              disabled={!isOnline}
              title="Hides the team from search and prevents new activity. Existing data is preserved."
            >
              Archive Team
            </button>
          </div>
        )}
      </fieldset>

      {isPlatformAdmin && (
        <fieldset className="page-card">
          <details className="partner-settings-collapsible" open={isPartner}>
            <summary><legend style={{ display: 'inline' }}>Partner Settings (Steward)</legend></summary>
            <div className="partner-settings-body">
              <PartnerSettingsFields
                patterns={editPatterns}
                onPatternsChange={setEditPatterns}
                customCss={editCss}
                onCustomCssChange={setEditCss}
              />

              <button
                className="primary-button"
                disabled={!isOnline}
                onClick={async () => {
                  if (!id) return
                  const patterns = editPatterns.split('\n').map(l => l.trim()).filter(Boolean)
                  await updateEmailPatterns(id, patterns)
                  await updateCustomCss(id, editCss || null)
                }}
              >
                Save Partner Settings
              </button>
            </div>
          </details>
        </fieldset>
      )}

      <fieldset className="page-card">
        <legend>Members ({members.length})</legend>
        <MemberList
          members={members}
          canPromote={isOrganizer}
          onPromote={(userId) => id && promoteMember(id, userId)}
        />
      </fieldset>

      {isMember && (
        <fieldset className="page-card">
          <legend>Messages</legend>
          <MessageBoard
            messages={messages}
            onPost={(audience, subject, body) => postMessage(id!, audience, subject, body)}
            canPost={isMember}
            isOrganizer={isOrganizer}
            isLoading={isLoadingMessages}
          />
        </fieldset>
      )}

      {showArchiveConfirm && (
        <ConfirmDialog
          title="Archive Team"
          actions={
            <>
              <button className="secondary-button" onClick={() => setShowArchiveConfirm(false)}>Cancel</button>
              <button className="danger-button" onClick={handleArchive}>Archive</button>
            </>
          }
        >
          <p>Are you sure you want to archive <strong>{team.name}</strong>? This will deactivate the team for all members.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
