import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { GuestBanner } from './GuestBanner'
import { LoginForm } from './LoginForm'
import { ProfileEditor } from './ProfileEditor'

export function AppLayout() {
  const { user, guestId, initializeGuest, logout, refreshTokenIfNeeded } = useAuthStore()
  const { isAdmin, checkAdminStatus } = useAdminStore()

  useEffect(() => {
    // Generate client-side guest ID on app load if not authenticated
    if (!user) {
      initializeGuest()
    }
  }, [user, initializeGuest])

  useEffect(() => {
    if (user) {
      checkAdminStatus()
      // Refresh session token if expiring within 30 days
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>CleanCentive</h1>
        {(user || guestId) && (
          <div className="user-menu">
            <span>Welcome, {user?.nickname || 'Guest'}!</span>
            {user && isAdmin && (
              <Link to="/admin" className="admin-link">Admin</Link>
            )}
            {user && (
              <button onClick={logout} className="logout-button">
                Sign Out
              </button>
            )}
          </div>
        )}
      </header>

      <main className="app-main">
        {!user && !guestId ? (
          <div className="auth-section">
            <div className="auth-content">
              <div className="auth-intro">
                <h2>Welcome to CleanCentive</h2>
                <p>Your personal cleaning companion for a spotless home.</p>
                <ul>
                  <li>Track your cleaning tasks</li>
                  <li>Get personalized recommendations</li>
                  <li>Monitor your progress over time</li>
                </ul>
              </div>
              <LoginForm />
            </div>
          </div>
        ) : (
          <div className="dashboard">
            <ProfileEditor />
            <div className="dashboard-content">
              <h2>Dashboard</h2>
              <p>Welcome to your CleanCentive dashboard! The cleaning management features will be implemented here.</p>
            </div>
          </div>
        )}
      </main>

      <GuestBanner />
    </div>
  )
}