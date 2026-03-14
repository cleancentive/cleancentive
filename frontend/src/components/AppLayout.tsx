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
              <p>Track cleanup impact with offline-first photo reporting.</p>
              <ul>
                <li>Capture litter photos with geolocation</li>
                <li>Create thumbnails and queue uploads offline</li>
                <li>Auto-sync uploads as soon as you reconnect</li>
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
