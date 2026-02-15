import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'

export function ProfileEditor() {
  const { user, updateProfile, isLoading, error, clearError } = useAuthStore()
  const [nickname, setNickname] = useState('')
  const [fullName, setFullName] = useState('')
  const [isEditing, setIsEditing] = useState(false)

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
    } catch (error) {
      // Error is handled by the store
    }
  }

  const handleCancel = () => {
    setNickname(user?.nickname || '')
    setFullName(user?.full_name || '')
    setIsEditing(false)
    clearError()
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

          <div className="profile-field">
            <label>Email addresses:</label>
            <div className="email-list">
              {user.emails.map((email, index) => (
                <div key={index} className="email-item">
                  <span>{email.email}</span>
                  {email.is_selected_for_login && (
                    <span className="login-email">(login email)</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => setIsEditing(true)}
            className="primary-button"
          >
            Edit Profile
          </button>
        </div>
      )}
    </div>
  )
}