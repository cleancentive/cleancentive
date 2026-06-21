import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackLink } from './BackLink'
import { useAdminStore } from '../stores/adminStore'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { formatTimestamp } from '../utils/formatTimestamp'
import axios from 'axios'
import { Avatar } from './Avatar'

import { API_BASE } from '../lib/apiBase'

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
  const { t } = useTranslation(['teams', 'common'])
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
        setError(err.response?.data?.message || t('user.loadFailed'))
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
    return <div className="user-detail"><p className="loading">{t('common:actions.loading')}</p></div>
  }

  if (error || !user) {
    return (
      <div className="user-detail">
        <p className="error-text">{error || t('user.notFound')}</p>
        <BackLink to="/steward/users" fallbackNoun="users" />
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
        {user.avatar_email_id && (
          <Avatar userId={user.id} avatarEmailId={user.avatar_email_id} nickname={user.nickname} size={64} />
        )}
        <h2>
          {user.nickname}
          {user.is_admin && <span className="badge admin-badge">{t('user.adminBadge')}</span>}
        </h2>
        {user.full_name && <p className="full-name">{user.full_name}</p>}

        <div className="info-grid">
          <div className="info-item">
            <label>{t('user.userId')}</label>
            <span className="mono">{user.id}</span>
          </div>
          <div className="info-item">
            <label>{t('user.created')}</label>
            <span>{formatTimestamp(user.created_at)}</span>
          </div>
          <div className="info-item">
            <label>{t('user.lastUpdated')}</label>
            <span>{formatTimestamp(user.updated_at)}</span>
          </div>
          <div className="info-item">
            <label>{t('user.lastLogin')}</label>
            <span>{user.last_login ? formatTimestamp(user.last_login) : t('user.never')}</span>
          </div>
        </div>

        <div className="emails-section">
          <h3>{t('user.emailAddresses')}</h3>
          <ul className="email-list">
            {user.emails.map(email => (
              <li key={email.id}>
                {email.email}
                {email.is_selected_for_login && <span className="badge">{t('user.loginEmail')}</span>}
              </li>
            ))}
            {user.emails.length === 0 && <li className="no-emails">{t('user.noEmails')}</li>}
          </ul>
        </div>

        {isAdmin && (
          <div className="admin-actions">
            <h3>{t('user.adminActions')}</h3>
            <div className="action-buttons">
              {!user.is_admin ? (
                <button onClick={handlePromote} disabled={!isOnline} className="btn-promote">
                  {t('user.promoteToAdmin')}
                </button>
              ) : (
                <button onClick={handleDemote} disabled={!isOnline} className="btn-demote">
                  {t('user.removeAdminRole')}
                </button>
              )}
            </div>
            {user.is_admin && (
              <p className="admin-note">
                {t('user.adminNote')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
