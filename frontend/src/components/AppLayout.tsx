import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { GuestBanner } from './GuestBanner'
import { LoginForm } from './LoginForm'
import { ProfileEditor } from './ProfileEditor'

export function AppLayout() {
  const { user, guestId, initializeGuest, logout } = useAuthStore()

  useEffect(() => {
    // Initialize guest account on app load if not authenticated
    if (!user && !guestId) {
      initializeGuest()
    }
  }, [user, guestId, initializeGuest])

  return (
    <div className="app">
      <header className="app-header">
        <h1>CleanCentive</h1>
        {(user || guestId) && (
          <div className="user-menu">
            <span>Welcome, {user?.nickname || 'Guest'}!</span>
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