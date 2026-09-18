import { useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CleanupCalendarSection } from './CleanupCalendarSection'

interface CleanupHeaderCardProps {
  cleanup: { name: string; description: string }
  team: { id: string; name: string } | null
  organizerTeams: Array<{ id: string; name: string }>
  hasUser: boolean
  isParticipant: boolean
  isOrganizer: boolean
  isOnline: boolean
  error: string | null
  joinedWebcal: string | null
  onUpdate: (name: string, description: string, teamId: string | null) => Promise<void> | void
  onJoin: () => void
  onLeave: () => void
  onArchiveRequest: () => void
  onClearError: () => void
  onSignIn: () => void
}

export function CleanupHeaderCard({
  cleanup,
  team,
  organizerTeams,
  hasUser,
  isParticipant,
  isOrganizer,
  isOnline,
  error,
  joinedWebcal,
  onUpdate,
  onJoin,
  onLeave,
  onArchiveRequest,
  onClearError,
  onSignIn,
}: CleanupHeaderCardProps) {
  const { t } = useTranslation(['cleanups', 'common'])
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editTeamId, setEditTeamId] = useState('')

  // The current team stays selectable even when the editor does not organize it,
  // so saving an unrelated edit cannot silently drop the team.
  const teamOptions = team && !organizerTeams.some((option) => option.id === team.id)
    ? [...organizerTeams, team]
    : organizerTeams

  return (
    <fieldset className="page-card">
      {editing ? (
        <div className="community-edit-form">
          <div className="form-group">
            <label>{t('cleanups:header.nameLabel')}</label>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>{t('cleanups:header.descriptionLabel')}</label>
            <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
          </div>
          {teamOptions.length > 0 && (
            <div className="form-group">
              <label htmlFor="cleanup-edit-team">{t('cleanups:header.teamLabel')}</label>
              <select id="cleanup-edit-team" value={editTeamId} onChange={(e) => setEditTeamId(e.target.value)}>
                <option value="">{t('cleanups:createForm.teamNone')}</option>
                {teamOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="community-actions">
            <button
              className="primary-button"
              disabled={!editName.trim() || !isOnline}
              onClick={async () => {
                await onUpdate(editName, editDescription, editTeamId || null)
                setEditing(false)
              }}
            >
              {t('common:actions.save')}
            </button>
            <button className="secondary-button" onClick={() => setEditing(false)}>{t('common:actions.cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          <legend>
            {cleanup.name}
            {isOrganizer && (
              <button
                className="link-button legend-edit-button"
                onClick={() => { setEditName(cleanup.name); setEditDescription(cleanup.description); setEditTeamId(team?.id ?? ''); setEditing(true) }}
              >
                {t('common:actions.edit')}
              </button>
            )}
          </legend>
          {cleanup.description && <p className="cleanup-description-display">{cleanup.description}</p>}
          {team && (
            <p className="partner-notice">
              <Trans
                t={t}
                i18nKey="cleanups:header.organizedBy"
                values={{ team: team.name }}
                components={{ teamLink: <Link to={`/teams/${team.id}`} /> }}
              />
            </p>
          )}
        </>
      )}

      {error && (
        <div className="error-message">
          {error}
          <button onClick={onClearError}>&times;</button>
        </div>
      )}

      {!hasUser && (
        <div className="community-guest-cta">
          <span>{t('cleanups:header.signInToJoin')}</span>
          <button className="sign-in-cta-button" onClick={onSignIn}>{t('common:actions.signIn')}</button>
        </div>
      )}

      {hasUser && !isParticipant && (
        <button className="primary-button" onClick={onJoin} disabled={!isOnline}>
          {t('cleanups:header.join')}
        </button>
      )}

      {hasUser && isParticipant && (
        <div className="community-actions">
          <button className="danger-button" onClick={onLeave} disabled={!isOnline}>
            {t('cleanups:header.leave')}
          </button>
        </div>
      )}

      {hasUser && isParticipant && <CleanupCalendarSection joinedWebcal={joinedWebcal} />}

      {isOrganizer && (
        <div className="community-admin-actions">
          <h3>{t('cleanups:header.organizerActions')}</h3>
          <button
            className="danger-button"
            onClick={onArchiveRequest}
            disabled={!isOnline}
            title={t('cleanups:header.archiveTitle')}
          >
            {t('cleanups:header.archive')}
          </button>
        </div>
      )}
    </fieldset>
  )
}
