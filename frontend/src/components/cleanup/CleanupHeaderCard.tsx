import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CleanupCalendarSection } from './CleanupCalendarSection'

interface CleanupHeaderCardProps {
  cleanup: { name: string; description: string }
  hasUser: boolean
  isParticipant: boolean
  isOrganizer: boolean
  isOnline: boolean
  error: string | null
  joinedWebcal: string | null
  onUpdate: (name: string, description: string) => Promise<void> | void
  onJoin: () => void
  onLeave: () => void
  onArchiveRequest: () => void
  onClearError: () => void
  onSignIn: () => void
}

export function CleanupHeaderCard({
  cleanup,
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
          <div className="community-actions">
            <button
              className="primary-button"
              disabled={!editName.trim() || !isOnline}
              onClick={async () => {
                await onUpdate(editName, editDescription)
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
                onClick={() => { setEditName(cleanup.name); setEditDescription(cleanup.description); setEditing(true) }}
              >
                {t('common:actions.edit')}
              </button>
            )}
          </legend>
          {cleanup.description && <p className="cleanup-description-display">{cleanup.description}</p>}
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
