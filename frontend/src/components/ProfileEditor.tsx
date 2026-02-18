import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'

export function ProfileEditor() {
  const {
    user, updateProfile, addEmail, confirmMerge, removeEmail,
    updateEmailSelection, deleteAccount, anonymizeAccount,
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

  if (!user) return null

  return (
    <div className="profile-editor">
      <h2>Your Profile</h2>

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
              disabled={isLoading || !nickname.trim()}
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
            className="primary-button"
          >
            Edit Profile
          </button>
        </div>
      )}

      <div className="email-management">
        <h3>Email Addresses</h3>

        <div className="email-list">
          {user.emails.map((email) => (
            <div key={email.id} className="email-item">
              <label className="email-checkbox">
                <input
                  type="checkbox"
                  checked={email.is_selected_for_login}
                  onChange={() => handleToggleLoginEmail(email.id, email.is_selected_for_login)}
                  disabled={isLoading}
                  title="Receive magic links at this address"
                />
                <span>{email.email}</span>
                {email.is_selected_for_login && (
                  <span className="login-email">(login)</span>
                )}
              </label>
              <button
                onClick={() => handleRemoveEmail(email.id)}
                disabled={isLoading}
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
            disabled={isLoading || !newEmail.trim()}
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
      </div>

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
                disabled={isLoading}
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
                disabled={isLoading}
                className="danger-button"
              >
                Delete all data
              </button>
              <button
                onClick={async () => {
                  setShowDeleteConfirm(null)
                  await anonymizeAccount()
                }}
                disabled={isLoading}
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
    </div>
  )
}
