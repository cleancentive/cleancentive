import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { useUiStore } from '../stores/uiStore'
import { CapturePanel } from './CapturePanel'
import { HistoryPanel } from './HistoryPanel'
import { API_BASE } from '../lib/apiBase'

export function AppLayout() {
  const { t } = useTranslation(['shell', 'common'])
  const { user, guestId, initializeGuest, refreshTokenIfNeeded } = useAuthStore()
  const { checkAdminStatus } = useAdminStore()
  const { openSignInModal } = useUiStore()

  useEffect(() => {
    if (!user) {
      initializeGuest()
    }
  }, [user, initializeGuest])

  useEffect(() => {
    if (user) {
      checkAdminStatus()
      refreshTokenIfNeeded()
    }
  }, [user, checkAdminStatus, refreshTokenIfNeeded])

  useEffect(() => {
    const handleBeforeUnload = () => {
      const { sessionToken } = useAuthStore.getState()
      if (!sessionToken) return

      const blob = new Blob(
        [JSON.stringify({ token: sessionToken })],
        { type: 'application/json' }
      )
      navigator.sendBeacon(`${API_BASE}/auth/last-seen`, blob)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  if (!user && !guestId) {
    return (
      <div className="auth-section">
        <div className="auth-content">
          <div className="auth-intro">
            <h2>{t('welcome.title')}</h2>
            <p>{t('welcome.intro')}</p>
            <ul>
              <li>{t('welcome.bullets.geolocation')}</li>
              <li>{t('welcome.bullets.offline')}</li>
              <li>{t('welcome.bullets.autoSync')}</li>
            </ul>
          </div>
          <button onClick={openSignInModal} className="primary-button">
            {t('common:actions.signIn')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <CapturePanel />
      <HistoryPanel />
    </div>
  )
}
