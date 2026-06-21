import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { BackLink } from './BackLink'
import { useTeamStore } from '../stores/teamStore'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { MemberList } from './MemberList'
import { MessageBoard } from './MessageBoard'
import { useUiStore } from '../stores/uiStore'
import { ConfirmDialog } from './ConfirmDialog'
import { PartnerSettingsFields } from './PartnerSettingsFields'

const WIKI_URL = window.__CLEANCENTIVE_CONFIG__?.wikiUrl
  || import.meta.env.VITE_WIKI_URL
  || 'https://wiki.cleancentive.local'

export function TeamDetail() {
  const { t } = useTranslation(['teams', 'common'])
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
    setTeamUnlisted,
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
    return <div className="community-detail"><p className="loading">{t('common:actions.loading')}</p></div>
  }

  if (error || !currentTeam) {
    return (
      <div className="community-detail">
        <p className="error-text">{error || t('detail.notFound')}</p>
        <BackLink to="/teams" fallbackNoun="teams" />
      </div>
    )
  }

  const { team, members, userRole, isPartner, systemKey, membershipManagedBy } = currentTeam
  const isMember = userRole !== null
  const isOrganizer = userRole === 'organizer'
  const isStewardsTeam = systemKey === 'stewards' || membershipManagedBy === 'steward-role'
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
      <BackLink to="/teams" fallbackNoun="teams" />

      <fieldset className="page-card">
        {editing ? (
          <div className="community-edit-form">
            <div className="form-group">
              <label>{t('detail.editName')}</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>{t('detail.editDescription')}</label>
              <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
            </div>
            <div className="community-actions">
              <button className="primary-button" disabled={!editName.trim() || !isOnline} onClick={async () => {
                if (!id) return
                await updateTeam(id, { name: editName, description: editDescription })
                setEditing(false)
              }}>{t('common:actions.save')}</button>
              <button className="secondary-button" onClick={() => setEditing(false)}>{t('common:actions.cancel')}</button>
            </div>
          </div>
        ) : (
          <>
            <legend>
              {team.name}
              {isOrganizer && !isStewardsTeam && <button className="link-button legend-edit-button" onClick={() => { setEditName(team.name); setEditDescription(team.description); setEditing(true) }}>{t('common:actions.edit')}</button>}
              {currentTeam?.outlineCollectionId && (
                <a
                  className="link-button legend-edit-button"
                  href={`${WIKI_URL}/collection/${currentTeam.outlineCollectionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >{t('detail.wiki')}</a>
              )}
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

        {!user && !isStewardsTeam && !isPartner && (
          <div className="community-guest-cta">
            <span>{t('detail.signInToJoin')}</span>
            <button className="sign-in-cta-button" onClick={openSignInModal}>{t('common:actions.signIn')}</button>
          </div>
        )}

        {isStewardsTeam && (
          <p className="partner-notice">
            <span className="badge steward-badge">{t('list.badges.stewards')}</span>
            {' '}{t('detail.stewardsNotice')}
          </p>
        )}

        {isPartner && !isStewardsTeam && (
          <p className="partner-notice">
            <span className="badge" style={{ background: 'var(--color-badge-partner)' }}>{t('list.badges.partner')}</span>
            {' '}{t('detail.partnerNotice')}
          </p>
        )}

        {user && !isMember && !isPartner && !isStewardsTeam && (
          <button className="primary-button" onClick={handleJoin} disabled={!isOnline}>
            {t('detail.joinTeam')}
          </button>
        )}

        {user && isMember && (
          <div className="community-actions">
            {activeTeamId === team.id ? (
              <button className="secondary-button" onClick={handleDeactivate} disabled={!isOnline}>
                {t('detail.deactivateTeam')}
              </button>
            ) : (
              <button className="secondary-button" onClick={handleActivate} disabled={!isOnline}>
                {t('detail.setActiveTeam')}
              </button>
            )}
            {!isPartner && !isStewardsTeam && (
              <button className="danger-button" onClick={handleLeave} disabled={!isOnline}>
                {t('detail.leaveTeam')}
              </button>
            )}
          </div>
        )}

        {isOrganizer && !isStewardsTeam && (
          <div className="community-admin-actions">
            <h3>{t('detail.organizerActions')}</h3>
            {isPartner && (
              <button
                className="secondary-button"
                onClick={() => id && setTeamUnlisted(id, !team.is_unlisted)}
                disabled={!isOnline}
                title={t('detail.unlistTitle')}
              >
                {team.is_unlisted ? t('detail.listTeam') : t('detail.unlistTeam')}
              </button>
            )}
            <button
              className="danger-button"
              onClick={() => setShowArchiveConfirm(true)}
              disabled={!isOnline}
              title={t('detail.archiveTitle')}
            >
              {t('detail.archiveTeam')}
            </button>
          </div>
        )}
      </fieldset>

      {isPlatformAdmin && !isStewardsTeam && (
        <fieldset className="page-card">
          <details className="partner-settings-collapsible" open={isPartner}>
            <summary><legend style={{ display: 'inline' }}>{t('detail.partnerSettingsSteward')}</legend></summary>
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
                {t('detail.savePartnerSettings')}
              </button>
            </div>
          </details>
        </fieldset>
      )}

      <fieldset className="page-card">
        <legend>{t('detail.members', { count: members.length })}</legend>
        <MemberList
          members={members}
          canPromote={isOrganizer && !isStewardsTeam}
          onPromote={(userId) => id && promoteMember(id, userId)}
        />
      </fieldset>

      {isMember && (
        <fieldset className="page-card">
          <legend>{t('detail.messages')}</legend>
          <MessageBoard
            messages={messages}
            onPost={(audience, subject, body, ccSender) => postMessage(id!, audience, subject, body, ccSender)}
            canPost={isMember}
            isOrganizer={isOrganizer}
            isLoading={isLoadingMessages}
          />
        </fieldset>
      )}

      {showArchiveConfirm && (
        <ConfirmDialog
          title={t('detail.archiveTeam')}
          actions={
            <>
              <button className="secondary-button" onClick={() => setShowArchiveConfirm(false)}>{t('common:actions.cancel')}</button>
              <button className="danger-button" onClick={handleArchive}>{t('detail.archiveConfirm')}</button>
            </>
          }
        >
          <p>
            <Trans
              t={t}
              i18nKey="detail.archivePrompt"
              values={{ name: team.name }}
              components={{ strong: <strong /> }}
            />
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
