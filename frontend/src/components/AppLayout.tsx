import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { GuestBanner } from './GuestBanner'
import { LoginForm } from './LoginForm'
import { CapturePanel } from './CapturePanel'
import { HistoryPanel } from './HistoryPanel'

export function AppLayout() {
  const { user, guestId, initializeGuest, refreshTokenIfNeeded } = useAuthStore()
  const { checkAdminStatus } = useAdminStore()

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
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
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
      <>
        <div className="auth-section">
          <div className="auth-content">
            <div className="auth-intro">
              <h2>Welcome to CleanCentive</h2>
              <p>Track your litter picks with offline-first photo logging.</p>
              <ul>
                <li>Log litter picks with geolocation</li>
                <li>Queue picks offline with thumbnails</li>
                <li>Auto-sync as soon as you reconnect</li>
              </ul>
            </div>
            <LoginForm />
          </div>
        </div>
        <GuestBanner />
      </>
    )
  }

  return (
    <>
      <div className="dashboard">
        <div className="dashboard-content">
          <CapturePanel />
          <HistoryPanel />
        </div>
      </div>
      <GuestBanner />
    </>
  )
}
