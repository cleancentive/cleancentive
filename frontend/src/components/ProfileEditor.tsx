import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useUiStore } from '../stores/uiStore'
import { suggestNicknameFromEmail } from '../lib/nicknameSuggestion'
import { useCopyToClipboard } from '../lib/useCopyToClipboard'
import { Avatar } from './Avatar'
import { ConfirmDialog } from './ConfirmDialog'
import { SignIn } from './SignIn'

export function ProfileEditor() {
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
      setUploadError(err?.response?.data?.message || 'Failed to upload avatar')
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

  const sortedEmails = useMemo(
    () => [...(user?.emails ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
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

  if (!user) return (
    <div className="profile-page">
      <p>Sign in to view and edit your profile.</p>
      <SignIn />
      {pickCount > 0 && (
        <>
          <div className="profile-sign-out">
            <button onClick={() => setShowAccountDelete(true)} disabled={!isOnline} className="danger-button">
              Delete Guest Data
            </button>
          </div>
          {showAccountDelete && (
            <ConfirmDialog title="Delete Guest Data" actions={
              <>
                <button
                  onClick={async () => {
                    setShowAccountDelete(false)
                    await deleteGuestData('delete')
                  }}
                  disabled={!isOnline || isLoading}
                  className="danger-button"
                >
                  Delete all data
                </button>
                <button
                  onClick={() => {
                    setShowAccountDelete(false)
                    logout()
                  }}
                  className="secondary-button"
                >
                  Just forget me locally
                </button>
                <button
                  onClick={() => setShowAccountDelete(false)}
                  disabled={isLoading}
                  className="secondary-button"
                >
                  Cancel
                </button>
              </>
            }>
              <p>Choose what to do with your picks:</p>
            </ConfirmDialog>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="profile-page">
      {!isOnline && <p className="offline-banner">You're offline — editing is paused.</p>}

      <fieldset className="page-card" disabled={!isOnline || isLoading}>
        <legend>Name</legend>
        {isEditing ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="nickname">Nickname *</label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Choose a unique nickname"
                required
                disabled={isLoading}
                minLength={1}
                maxLength={50}
              />
            </div>

            <div className="form-group">
              <label htmlFor="fullName">Full Name</label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name (optional)"
                disabled={isLoading}
                maxLength={100}
              />
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
                {isLoading ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isLoading}
                className="secondary-button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="profile-display">
            <div className="profile-field">
              <label>Nickname:</label>
              <span>{user.nickname}</span>
            </div>

            <div className="profile-field">
              <label>Full Name:</label>
              <span>{user.full_name || 'Not set'}</span>
            </div>

            {user.nickname === 'guest' && suggestNicknameFromEmail(user.emails) && (
              <button
                type="button"
                className="suggested-nickname-chip"
                onClick={handleAdoptSuggestedNickname}
                disabled={!isOnline || isLoading}
              >
                Suggested: {suggestNicknameFromEmail(user.emails)}
              </button>
            )}

            <button
              onClick={() => setIsEditing(true)}
              disabled={!isOnline}
              className="primary-button"
            >
              Edit Profile
            </button>
          </div>
        )}
      </fieldset>

      <fieldset id="picture" className="page-card avatar-email-picker" disabled={!isOnline || isLoading}>
        <legend>Picture</legend>
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
              ? 'Uploading...'
              : user.uploaded_avatar_key
                ? 'Replace photo'
                : 'Upload a photo'}
          </button>
          {user.uploaded_avatar_key && (
            <button
              type="button"
              className="link-button"
              onClick={() => removeUploadedAvatar()}
              disabled={!isOnline || uploadingAvatar}
            >
              Remove photo
            </button>
          )}
          {uploadError && <p className="form-warning">{uploadError}</p>}
        </div>

        {sortedEmails.length > 0 && (
          <>
            <p className="avatar-hint">
              Or use <a href="https://gravatar.com" target="_blank" rel="noopener noreferrer">Gravatar</a> — set a photo once and it shows up wherever your email is recognized. Your email is hashed before lookup and never exposed to other users.
            </p>
            {user.uploaded_avatar_key && (
              <p className="avatar-hint">
                You have an uploaded photo. Remove it to use Gravatar.
              </p>
            )}
            <label className="avatar-radio">
              <input
                type="radio"
                name="avatarEmail"
                checked={!user.avatar_email_id}
                onChange={() => updateAvatarEmail(null)}
              />
              <span>No Gravatar</span>
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
        <legend>Emails</legend>

        <div className="email-list">
          {sortedEmails.map((email) => (
            <div key={email.id} className="email-item">
              <label className="email-checkbox">
                <input
                  type="checkbox"
                  checked={email.is_selected_for_login}
                  onChange={() => handleToggleLoginEmail(email.id, email.is_selected_for_login)}
                  disabled={!isOnline || isLoading}
                  title="Receive magic links at this address"
                />
                <span>{email.email}</span>
                {email.is_selected_for_login && (
                  <span className="login-email">login</span>
                )}
              </label>
              <label className="email-checkbox calendar-toggle" title="Receive cleanup invites at this address">
                <input
                  type="checkbox"
                  checked={email.calendar_emails_enabled}
                  onChange={() => handleToggleCalendarEmail(email.id, email.calendar_emails_enabled)}
                  disabled={!isOnline || isLoading}
                />
                <span>calendar</span>
              </label>
              <button
                onClick={() => handleRemoveEmail(email.id)}
                disabled={!isOnline || isLoading}
                className="remove-email-button"
                title="Remove email"
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
            placeholder="Add another email"
            disabled={isLoading}
            required
          />
          <button
            type="submit"
            disabled={!isOnline || isLoading || !newEmail.trim()}
            className="secondary-button"
          >
            Add
          </button>
        </form>

        {emailStatus === 'verification-sent' && (
          <p className="success-message">Verification email sent! Check your inbox.</p>
        )}
        {emailStatus === 'already-yours' && (
          <p className="warning-message">This email is already on your account.</p>
        )}
        {emailStatus === 'merge-sent' && (
          <p className="success-message">Merge request sent! The account owner must confirm via email.</p>
        )}

        {error && !isEditing && (
          <div className="error-message">
            {error}
          </div>
        )}
      </fieldset>

      <fieldset className="page-card" disabled={!isOnline || isLoading}>
        <legend>Calendar</legend>
        <p className="calendar-hint">
          Keep your personal calendar in sync with the cleanups you join. Subscribe once and updates appear automatically — the first time you pull the feed we'll silently turn off the calendar emails above. Re-tick any email to start receiving invites again.
        </p>

        {calendarUrls && (
          <div className="calendar-feeds">
            <div className="calendar-feed">
              <div className="calendar-feed-label">My joined cleanups</div>
              <code className="calendar-feed-url">{calendarUrls.joinedWebcal}</code>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleCopy(calendarUrls.joinedWebcal)}
              >
                {copiedUrl === calendarUrls.joinedWebcal ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="calendar-feed">
              <div className="calendar-feed-label">Discover (upcoming, not joined)</div>
              <code className="calendar-feed-url">{calendarUrls.discoverWebcal}</code>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleCopy(calendarUrls.discoverWebcal)}
              >
                {copiedUrl === calendarUrls.discoverWebcal ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="calendar-hint">
              Add the link in Google Calendar &rarr; Other calendars &rarr; From URL, Apple Calendar &rarr; File &rarr; New Calendar Subscription, or Outlook &rarr; Add calendar &rarr; Subscribe from web.
            </p>
          </div>
        )}
      </fieldset>

      {conflictNickname && conflictEmail && (
        <ConfirmDialog title="Email belongs to another account" actions={
          <>
            <button
              onClick={handleConfirmMerge}
              disabled={!isOnline || isLoading}
              className="danger-button"
            >
              Send merge request
            </button>
            <button
              onClick={handleCancelMerge}
              disabled={isLoading}
              className="secondary-button"
            >
              Cancel
            </button>
          </>
        }>
          <p>
            This email belongs to account &lsquo;{conflictNickname}&rsquo;. Adding it will send them a merge request. If they confirm, their data merges into yours and their account is deleted.
          </p>
        </ConfirmDialog>
      )}

      {showDeleteConfirm && (
        <ConfirmDialog title="Remove last email" actions={
          <>
            <button
              onClick={async () => {
                setShowDeleteConfirm(null)
                await deleteAccount()
              }}
              disabled={!isOnline || isLoading}
              className="danger-button"
            >
              Delete all data
            </button>
            <button
              onClick={async () => {
                setShowDeleteConfirm(null)
                await anonymizeAccount()
              }}
              disabled={!isOnline || isLoading}
              className="secondary-button"
            >
              Only delete personal info
            </button>
            <button
              onClick={() => setShowDeleteConfirm(null)}
              disabled={isLoading}
              className="secondary-button"
            >
              Cancel
            </button>
          </>
        }>
          <p>This is your only email address. Removing it will de-authenticate your account. Choose what to do with your data:</p>
        </ConfirmDialog>
      )}

      <div className="profile-sign-out">
        <button
          onClick={() => setShowAccountDelete(true)}
          disabled={!isOnline}
          className="danger-button"
        >
          Delete Account
        </button>
      </div>

      {showAccountDelete && (
        <ConfirmDialog title="Delete Account" actions={
          <>
            <button
              onClick={async () => {
                setShowAccountDelete(false)
                await deleteAccount()
              }}
              disabled={!isOnline || isLoading}
              className="danger-button"
            >
              Delete all data
            </button>
            <button
              onClick={async () => {
                setShowAccountDelete(false)
                await anonymizeAccount()
              }}
              disabled={!isOnline || isLoading}
              className="secondary-button"
            >
              Only delete personal info
            </button>
            <button
              onClick={() => setShowAccountDelete(false)}
              disabled={isLoading}
              className="secondary-button"
            >
              Cancel
            </button>
          </>
        }>
          <p>This action cannot be undone. Choose what to do with your data:</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
