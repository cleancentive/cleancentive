import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { SUPPORTED_LOCALES } from '@cleancentive/shared/locale'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useUiStore } from '../stores/uiStore'
import { suggestNicknameFromEmail, suggestFullNameFromEmail } from '../lib/nicknameSuggestion'
import { useCopyToClipboard } from '../lib/useCopyToClipboard'
import { Avatar } from './Avatar'
import { ConfirmDialog } from './ConfirmDialog'
import { SignIn } from './SignIn'

export function ProfileEditor() {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const { isOnline } = useConnectivityStore()
  const pickCount = useUiStore((s) => s.pickCount)
  const {
    user, logout, deleteGuestData, updateProfile, addEmail, confirmMerge, removeEmail,
    updateEmailSelection, updateAvatarEmail, uploadAvatar, removeUploadedAvatar,
    deleteAccount, anonymizeAccount,
    updateCalendarEmailSelection, getCalendarUrls,
    isLoading, error, clearError
  } = useAuthStore()

  const [nickname, setNickname] = useState('')
  const [fullName, setFullName] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailStatus, setEmailStatus] = useState<string | null>(null)
  const [conflictNickname, setConflictNickname] = useState<string | null>(null)
  const [conflictEmail, setConflictEmail] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [showAccountDelete, setShowAccountDelete] = useState(false)
  const [calendarUrls, setCalendarUrls] = useState<{ joinedHttp: string; joinedWebcal: string; discoverHttp: string; discoverWebcal: string } | null>(null)
  const { copiedValue: copiedUrl, copy: copyUrl } = useCopyToClipboard()
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarUpload = async (file: File) => {
    setUploadError(null)
    setUploadingAvatar(true)
    try {
      await uploadAvatar(file)
    } catch (err: any) {
      setUploadError(err?.response?.data?.message || t('picture.uploadFailed'))
    } finally {
      setUploadingAvatar(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  const handleAdoptSuggestedNickname = async () => {
    if (!user) return
    const suggestion = suggestNicknameFromEmail(user.emails)
    if (!suggestion) return
    clearError()
    await updateProfile({ nickname: suggestion })
  }

  const handleLanguageChange = async (value: string) => {
    const next = value === 'auto' ? null : value
    if (next) void i18n.changeLanguage(next)
    if (user) await updateProfile({ locale: next })
  }

  const sortedEmails = useMemo(
    () => [...(user?.emails ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    [user?.emails]
  )

  const suggestedFullName = useMemo(
    () => suggestFullNameFromEmail(user?.emails),
    [user?.emails]
  )

  useEffect(() => {
    if (user) {
      setNickname(user.nickname)
      setFullName(user.full_name || '')
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    getCalendarUrls().then((urls) => {
      if (!cancelled && urls) {
        setCalendarUrls({
          joinedHttp: urls.joinedHttp,
          joinedWebcal: urls.joinedWebcal,
          discoverHttp: urls.discoverHttp,
          discoverWebcal: urls.discoverWebcal,
        })
      }
    })
    return () => { cancelled = true }
  }, [user?.id, getCalendarUrls])

  const handleCopy = (url: string) => copyUrl(url)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await updateProfile({
        nickname: nickname.trim(),
        full_name: fullName.trim() || null
      })
      setIsEditing(false)
    } catch {
      // Error is handled by the store
    }
  }

  const handleCancel = () => {
    setNickname(user?.nickname || '')
    setFullName(user?.full_name || '')
    setIsEditing(false)
    clearError()
  }

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    setEmailStatus(null)
    setConflictNickname(null)
    setConflictEmail(null)

    const result = await addEmail(newEmail.trim())

    if (result.status === 'verification-sent') {
      setEmailStatus('verification-sent')
      setNewEmail('')
    } else if (result.status === 'conflict') {
      setConflictNickname(result.ownerNickname || 'unknown')
      setConflictEmail(newEmail.trim())
      setNewEmail('')
    } else if (result.status === 'already-yours') {
      setEmailStatus('already-yours')
    }
  }

  const handleConfirmMerge = async () => {
    if (!conflictEmail) return
    clearError()

    const sent = await confirmMerge(conflictEmail)
    setConflictNickname(null)
    setConflictEmail(null)
    if (sent) {
      setEmailStatus('merge-sent')
    }
  }

  const handleCancelMerge = () => {
    setConflictNickname(null)
    setConflictEmail(null)
  }

  const handleRemoveEmail = async (emailId: string) => {
    if (!user) return

    if (user.emails.length === 1) {
      setShowDeleteConfirm(emailId)
      return
    }

    clearError()
    try {
      await removeEmail(emailId)
    } catch {
      // Error is handled by the store
    }
  }

  const handleToggleLoginEmail = async (emailId: string, currentlySelected: boolean) => {
    if (!user) return

    let newSelection: string[]
    if (currentlySelected) {
      const selectedCount = user.emails.filter(e => e.is_selected_for_login).length
      if (selectedCount <= 1) return
      newSelection = user.emails
        .filter(e => e.is_selected_for_login && e.id !== emailId)
        .map(e => e.id)
    } else {
      newSelection = [
        ...user.emails.filter(e => e.is_selected_for_login).map(e => e.id),
        emailId
      ]
    }

    clearError()
    await updateEmailSelection(newSelection)
  }

  const handleToggleCalendarEmail = async (emailId: string, currentlyEnabled: boolean) => {
    if (!user) return
    const newSelection = currentlyEnabled
      ? user.emails.filter(e => e.calendar_emails_enabled && e.id !== emailId).map(e => e.id)
      : [
          ...user.emails.filter(e => e.calendar_emails_enabled).map(e => e.id),
          emailId,
        ]
    clearError()
    await updateCalendarEmailSelection(newSelection)
  }

  const languageSelect = (
    <fieldset className="page-card" disabled={!isOnline || isLoading}>
      <legend>{t('language.legend')}</legend>
      <p className="form-hint">{t('language.hint')}</p>
      <select
        className="language-select"
        value={user?.locale ?? 'auto'}
        onChange={(e) => handleLanguageChange(e.target.value)}
        disabled={!isOnline || isLoading}
      >
        <option value="auto">{t('language.automatic')}</option>
        {SUPPORTED_LOCALES.map((lng) => (
          <option key={lng} value={lng}>{t(`language.${lng}`)}</option>
        ))}
      </select>
    </fieldset>
  )

  if (!user) return (
    <div className="profile-page">
      <p>{t('signInPrompt')}</p>
      <SignIn />
      {pickCount > 0 && (
        <>
          <div className="profile-sign-out">
            <button onClick={() => setShowAccountDelete(true)} disabled={!isOnline} className="danger-button">
              {t('guestData.button')}
            </button>
          </div>
          {showAccountDelete && (
            <ConfirmDialog title={t('guestData.title')} actions={
              <>
                <button
                  onClick={async () => {
                    setShowAccountDelete(false)
                    await deleteGuestData('delete')
                  }}
                  disabled={!isOnline || isLoading}
                  className="danger-button"
                >
                  {t('guestData.deleteAll')}
                </button>
                <button
                  onClick={() => {
                    setShowAccountDelete(false)
                    logout()
                  }}
                  className="secondary-button"
                >
                  {t('guestData.forgetLocally')}
                </button>
                <button
                  onClick={() => setShowAccountDelete(false)}
                  disabled={isLoading}
                  className="secondary-button"
                >
                  {t('common:actions.cancel')}
                </button>
              </>
            }>
              <p>{t('guestData.prompt')}</p>
            </ConfirmDialog>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="profile-page">
      {!isOnline && <p className="offline-banner">{t('common:status.offline')}</p>}

      <fieldset className="page-card" disabled={!isOnline || isLoading}>
        <legend>{t('name.legend')}</legend>
        {isEditing ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="nickname">{t('name.nicknameField')}</label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t('name.nicknamePlaceholder')}
                required
                disabled={isLoading}
                minLength={1}
                maxLength={50}
              />
            </div>

            <div className="form-group">
              <label htmlFor="fullName">{t('name.fullNameField')}</label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t('name.fullNamePlaceholder')}
                disabled={isLoading}
                maxLength={100}
              />
              {!fullName.trim() && suggestedFullName && (
                <button
                  type="button"
                  className="suggested-nickname-chip"
                  onClick={() => setFullName(suggestedFullName)}
                  disabled={isLoading}
                >
                  {t('name.suggested', { value: suggestedFullName })}
                </button>
              )}
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <div className="form-actions">
              <button
                type="submit"
                disabled={!isOnline || isLoading || !nickname.trim()}
                className="primary-button"
              >
                {isLoading ? t('common:actions.saving') : t('common:actions.saveChanges')}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isLoading}
                className="secondary-button"
              >
                {t('common:actions.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <div className="profile-display">
            <div className="profile-field">
              <label>{t('name.nicknameLabel')}</label>
              <span>{user.nickname}</span>
            </div>

            <div className="profile-field">
              <label>{t('name.fullNameLabel')}</label>
              <span>{user.full_name || t('common:status.notSet')}</span>
            </div>

            {user.nickname === 'guest' && suggestNicknameFromEmail(user.emails) && (
              <button
                type="button"
                className="suggested-nickname-chip"
                onClick={handleAdoptSuggestedNickname}
                disabled={!isOnline || isLoading}
              >
                {t('name.suggested', { value: suggestNicknameFromEmail(user.emails) })}
              </button>
            )}

            <button
              onClick={() => setIsEditing(true)}
              disabled={!isOnline}
              className="primary-button"
            >
              {t('name.editProfile')}
            </button>
          </div>
        )}
      </fieldset>

      {languageSelect}

      <fieldset id="picture" className="page-card avatar-email-picker" disabled={!isOnline || isLoading}>
        <legend>{t('picture.legend')}</legend>
        <div className="avatar-preview">
          <Avatar
            userId={user.id}
            avatarEmailId={user.avatar_email_id}
            uploadedAvatarUpdatedAt={user.uploaded_avatar_updated_at}
            nickname={user.nickname}
            size={80}
          />
        </div>

        <div className="avatar-upload">
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleAvatarUpload(file)
            }}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => uploadInputRef.current?.click()}
            disabled={!isOnline || uploadingAvatar}
          >
            {uploadingAvatar
              ? t('picture.uploading')
              : user.uploaded_avatar_key
                ? t('picture.replacePhoto')
                : t('picture.uploadPhoto')}
          </button>
          {user.uploaded_avatar_key && (
            <button
              type="button"
              className="link-button"
              onClick={() => removeUploadedAvatar()}
              disabled={!isOnline || uploadingAvatar}
            >
              {t('picture.removePhoto')}
            </button>
          )}
          {uploadError && <p className="form-warning">{uploadError}</p>}
        </div>

        {sortedEmails.length > 0 && (
          <>
            <p className="avatar-hint">
              <Trans
                t={t}
                i18nKey="picture.gravatarHint"
                components={{ gravatar: <a href="https://gravatar.com" target="_blank" rel="noopener noreferrer" /> }}
              />
            </p>
            {user.uploaded_avatar_key && (
              <p className="avatar-hint">
                {t('picture.uploadedHint')}
              </p>
            )}
            <label className="avatar-radio">
              <input
                type="radio"
                name="avatarEmail"
                checked={!user.avatar_email_id}
                onChange={() => updateAvatarEmail(null)}
              />
              <span>{t('picture.noGravatar')}</span>
            </label>
            {sortedEmails.map((email) => (
              <label key={email.id} className="avatar-radio">
                <input
                  type="radio"
                  name="avatarEmail"
                  checked={user.avatar_email_id === email.id}
                  onChange={() => updateAvatarEmail(email.id)}
                />
                <span>{email.email}</span>
              </label>
            ))}
          </>
        )}
      </fieldset>

      <fieldset className="page-card email-management" disabled={!isOnline || isLoading}>
        <legend>{t('emails.legend')}</legend>

        <div className="email-list">
          {sortedEmails.map((email) => (
            <div key={email.id} className="email-item">
              <label className="email-checkbox">
                <input
                  type="checkbox"
                  checked={email.is_selected_for_login}
                  onChange={() => handleToggleLoginEmail(email.id, email.is_selected_for_login)}
                  disabled={!isOnline || isLoading}
                  title={t('emails.loginTitle')}
                />
                <span>{email.email}</span>
                {email.is_selected_for_login && (
                  <span className="login-email">{t('emails.login')}</span>
                )}
              </label>
              <label className="email-checkbox calendar-toggle" title={t('emails.calendarTitle')}>
                <input
                  type="checkbox"
                  checked={email.calendar_emails_enabled}
                  onChange={() => handleToggleCalendarEmail(email.id, email.calendar_emails_enabled)}
                  disabled={!isOnline || isLoading}
                />
                <span>{t('emails.calendar')}</span>
              </label>
              <button
                onClick={() => handleRemoveEmail(email.id)}
                disabled={!isOnline || isLoading}
                className="remove-email-button"
                title={t('emails.removeTitle')}
              >
                x
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={handleAddEmail} className="add-email-form">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={t('emails.addPlaceholder')}
            disabled={isLoading}
            required
          />
          <button
            type="submit"
            disabled={!isOnline || isLoading || !newEmail.trim()}
            className="secondary-button"
          >
            {t('common:actions.add')}
          </button>
        </form>

        {emailStatus === 'verification-sent' && (
          <p className="success-message">{t('emails.verificationSent')}</p>
        )}
        {emailStatus === 'already-yours' && (
          <p className="warning-message">{t('emails.alreadyYours')}</p>
        )}
        {emailStatus === 'merge-sent' && (
          <p className="success-message">{t('emails.mergeSent')}</p>
        )}

        {error && !isEditing && (
          <div className="error-message">
            {error}
          </div>
        )}
      </fieldset>

      <fieldset className="page-card" disabled={!isOnline || isLoading}>
        <legend>{t('calendar.legend')}</legend>
        <p className="calendar-hint">
          {t('calendar.hint')}
        </p>

        {calendarUrls && (
          <div className="calendar-feeds">
            <div className="calendar-feed">
              <div className="calendar-feed-label">{t('calendar.joined')}</div>
              <code className="calendar-feed-url">{calendarUrls.joinedWebcal}</code>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleCopy(calendarUrls.joinedWebcal)}
              >
                {copiedUrl === calendarUrls.joinedWebcal ? t('calendar.copied') : t('common:actions.copy')}
              </button>
            </div>
            <div className="calendar-feed">
              <div className="calendar-feed-label">{t('calendar.discover')}</div>
              <code className="calendar-feed-url">{calendarUrls.discoverWebcal}</code>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleCopy(calendarUrls.discoverWebcal)}
              >
                {copiedUrl === calendarUrls.discoverWebcal ? t('calendar.copied') : t('common:actions.copy')}
              </button>
            </div>
            <p className="calendar-hint">
              {t('calendar.instructions')}
            </p>
          </div>
        )}
      </fieldset>

      {conflictNickname && conflictEmail && (
        <ConfirmDialog title={t('merge.title')} actions={
          <>
            <button
              onClick={handleConfirmMerge}
              disabled={!isOnline || isLoading}
              className="danger-button"
            >
              {t('merge.send')}
            </button>
            <button
              onClick={handleCancelMerge}
              disabled={isLoading}
              className="secondary-button"
            >
              {t('common:actions.cancel')}
            </button>
          </>
        }>
          <p>
            {t('merge.body', { nickname: conflictNickname })}
          </p>
        </ConfirmDialog>
      )}

      {showDeleteConfirm && (
        <ConfirmDialog title={t('removeLastEmail.title')} actions={
          <>
            <button
              onClick={async () => {
                setShowDeleteConfirm(null)
                await deleteAccount()
              }}
              disabled={!isOnline || isLoading}
              className="danger-button"
            >
              {t('deleteAccount.deleteAll')}
            </button>
            <button
              onClick={async () => {
                setShowDeleteConfirm(null)
                await anonymizeAccount()
              }}
              disabled={!isOnline || isLoading}
              className="secondary-button"
            >
              {t('deleteAccount.onlyPersonal')}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(null)}
              disabled={isLoading}
              className="secondary-button"
            >
              {t('common:actions.cancel')}
            </button>
          </>
        }>
          <p>{t('removeLastEmail.body')}</p>
        </ConfirmDialog>
      )}

      <div className="profile-sign-out">
        <button
          onClick={() => setShowAccountDelete(true)}
          disabled={!isOnline}
          className="danger-button"
        >
          {t('deleteAccount.button')}
        </button>
      </div>

      {showAccountDelete && (
        <ConfirmDialog title={t('deleteAccount.title')} actions={
          <>
            <button
              onClick={async () => {
                setShowAccountDelete(false)
                await deleteAccount()
              }}
              disabled={!isOnline || isLoading}
              className="danger-button"
            >
              {t('deleteAccount.deleteAll')}
            </button>
            <button
              onClick={async () => {
                setShowAccountDelete(false)
                await anonymizeAccount()
              }}
              disabled={!isOnline || isLoading}
              className="secondary-button"
            >
              {t('deleteAccount.onlyPersonal')}
            </button>
            <button
              onClick={() => setShowAccountDelete(false)}
              disabled={isLoading}
              className="secondary-button"
            >
              {t('common:actions.cancel')}
            </button>
          </>
        }>
          <p>{t('deleteAccount.body')}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
