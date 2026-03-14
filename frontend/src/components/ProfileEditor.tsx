import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { SignIn } from './SignIn'

export function ProfileEditor() {
  const { isOnline } = useConnectivityStore()
  const pickCount = useUiStore((s) => s.pickCount)
  const {
    user, logout, deleteGuestData, updateProfile, addEmail, confirmMerge, removeEmail,
    updateEmailSelection, updateAvatarEmail, deleteAccount, anonymizeAccount,
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

  useEffect(() => {
    if (user) {
      setNickname(user.nickname)
      setFullName(user.full_name || '')
    }
  }, [user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await updateProfile({
        nickname: nickname.trim(),
        full_name: fullName.trim() || undefined
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

  if (!user) return (
    <div className="profile-editor">
      <h2>Your Profile</h2>
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
            <div className="delete-confirm-overlay">
              <div className="delete-confirm-dialog">
                <h3>Delete Guest Data</h3>
                <p>Choose what to do with your picks:</p>
                <div className="form-actions">
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
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="profile-editor">
      <h2>Your Profile</h2>

      {!isOnline && <p className="offline-banner">You're offline — editing is paused.</p>}

      <fieldset className="profile-card" disabled={!isOnline || isLoading}>
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

      {user.emails.length > 0 && (
        <fieldset className="profile-card avatar-email-picker" disabled={!isOnline || isLoading}>
          <legend>Profile picture</legend>
          {user.avatar_email_id && (
            <div className="avatar-preview">
              <Avatar
                userId={user.id}
                avatarEmailId={user.avatar_email_id}
                nickname={user.nickname}
                size={80}
              />
            </div>
          )}
          <p className="avatar-hint">
            Your profile picture is loaded from <a href="https://gravatar.com" target="_blank" rel="noopener noreferrer">Gravatar</a>. The email address is never exposed to other users.
          </p>
          <label className="avatar-radio">
            <input
              type="radio"
              name="avatarEmail"
              checked={!user.avatar_email_id}
              onChange={() => updateAvatarEmail(null)}
            />
            <span>No Gravatar</span>
          </label>
          {user.emails.map((email) => (
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
        </fieldset>
      )}

      <fieldset className="profile-card email-management" disabled={!isOnline || isLoading}>
        <legend>Email addresses</legend>

        <div className="email-list">
          {user.emails.map((email) => (
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
                  <span className="login-email">(login)</span>
                )}
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

      {conflictNickname && conflictEmail && (
        <div className="delete-confirm-overlay">
          <div className="delete-confirm-dialog">
            <h3>Email belongs to another account</h3>
            <p>
              This email belongs to account &lsquo;{conflictNickname}&rsquo;. Adding it will send them a merge request. If they confirm, their data merges into yours and their account is deleted.
            </p>
            <div className="form-actions">
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
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="delete-confirm-overlay">
          <div className="delete-confirm-dialog">
            <h3>Remove last email</h3>
            <p>This is your only email address. Removing it will de-authenticate your account. Choose what to do with your data:</p>
            <div className="form-actions">
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
            </div>
          </div>
        </div>
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
        <div className="delete-confirm-overlay">
          <div className="delete-confirm-dialog">
            <h3>Delete Account</h3>
            <p>This action cannot be undone. Choose what to do with your data:</p>
            <div className="form-actions">
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
