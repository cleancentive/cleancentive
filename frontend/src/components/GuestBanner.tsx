import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { LoginForm } from './LoginForm'

export function GuestBanner() {
  const { user, guestId } = useAuthStore()
  const [showLogin, setShowLogin] = useState(false)

  // Don't show if user is authenticated or if there's no guest account
  if (user || !guestId) return null

  return (
    <div className="guest-banner">
      <div className="guest-banner-content">
        <div className="guest-info">
          <span className="guest-icon">👤</span>
          <div className="guest-text">
            <p><strong>You're browsing as a guest</strong></p>
            <p>Sign in to save your progress and access all features</p>
          </div>
        </div>

        <button
          onClick={() => setShowLogin(!showLogin)}
          className="sign-in-button"
        >
          {showLogin ? 'Cancel' : 'Sign In'}
        </button>
      </div>

      {showLogin && (
        <div className="guest-login-modal">
          <LoginForm />
        </div>
      )}
    </div>
  )
}