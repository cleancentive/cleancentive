import { useEffect, useState } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { useAdminStore } from '../stores/adminStore'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { formatTimestamp } from '../utils/formatTimestamp'
import axios from 'axios'
import { Avatar } from './Avatar'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface UserEmail {
  id: string
  email: string
  is_selected_for_login: boolean
}

interface UserData {
  id: string
  nickname: string
  full_name?: string
  avatar_email_id?: string | null
  last_login?: string
  created_at: string
  updated_at: string
  emails: UserEmail[]
  is_admin: boolean
}

export function UserDetail() {
  const { id } = useParams<{ id: string }>()
  const { sessionToken, user: currentUser } = useAuthStore()
  const { isAdmin, promoteUser, demoteUser } = useAdminStore()
  const { isOnline } = useConnectivityStore()
  const [user, setUser] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !sessionToken) return

    const fetchUser = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await axios.get(`${API_BASE}/admin/users/${id}`, {
          headers: { Authorization: `Bearer ${sessionToken}` }
        })
        setUser(response.data)
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load user')
      } finally {
        setIsLoading(false)
      }
    }

    fetchUser()
  }, [id, sessionToken])

  if (!currentUser) {
    return <Navigate to="/" replace />
  }

  if (isLoading) {
    return <div className="user-detail"><p className="loading">Loading...</p></div>
  }

  if (error || !user) {
    return (
      <div className="user-detail">
        <p className="error-text">{error || 'User not found'}</p>
        <Link to="/admin" className="back-link">Back</Link>
      </div>
    )
  }

  const handlePromote = async () => {
    await promoteUser(user.id)
    setUser(prev => prev ? { ...prev, is_admin: true } : prev)
  }

  const handleDemote = async () => {
    await demoteUser(user.id)
    setUser(prev => prev ? { ...prev, is_admin: false } : prev)
  }

  return (
    <div className="user-detail">
      <div className="user-info-section">
        <Avatar userId={user.id} avatarEmailId={user.avatar_email_id} nickname={user.nickname} size={64} />
        <h2>
          {user.nickname}
          {user.is_admin && <span className="badge admin-badge">Admin</span>}
        </h2>
        {user.full_name && <p className="full-name">{user.full_name}</p>}

        <div className="info-grid">
          <div className="info-item">
            <label>User ID</label>
            <span className="mono">{user.id}</span>
          </div>
          <div className="info-item">
            <label>Created</label>
            <span>{formatTimestamp(user.created_at)}</span>
          </div>
          <div className="info-item">
            <label>Last Updated</label>
            <span>{formatTimestamp(user.updated_at)}</span>
          </div>
          <div className="info-item">
            <label>Last Login</label>
            <span>{user.last_login ? formatTimestamp(user.last_login) : 'Never'}</span>
          </div>
        </div>

        <div className="emails-section">
          <h3>Email Addresses</h3>
          <ul className="email-list">
            {user.emails.map(email => (
              <li key={email.id}>
                {email.email}
                {email.is_selected_for_login && <span className="badge">Login Email</span>}
              </li>
            ))}
            {user.emails.length === 0 && <li className="no-emails">No emails (guest account)</li>}
          </ul>
        </div>

        {isAdmin && (
          <div className="admin-actions">
            <h3>Admin Actions</h3>
            <div className="action-buttons">
              {!user.is_admin ? (
                <button onClick={handlePromote} disabled={!isOnline} className="btn-promote">
                  Promote to Admin
                </button>
              ) : (
                <button onClick={handleDemote} disabled={!isOnline} className="btn-demote">
                  Remove Admin Role
                </button>
              )}
            </div>
            {user.is_admin && (
              <p className="admin-note">
                Note: If this user's email is in ADMIN_EMAILS, they will be re-promoted on next login or server restart.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
