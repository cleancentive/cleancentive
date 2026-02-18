import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isRecovery, setIsRecovery] = useState(false)
  const [recoverySent, setRecoverySent] = useState(false)
  const { login, recoverAccount, isLoading, error, clearError, guestReady } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await login(email)
      setIsSubmitted(true)
    } catch {
      // Error is handled by the store
    }
  }

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await recoverAccount(email)
      setRecoverySent(true)
    } catch {
      // Error is handled by the store
    }
  }

  if (recoverySent && !error) {
    return (
      <div className="login-form success">
        <h2>Recovery emails sent!</h2>
        <p>If an account exists for <strong>{email}</strong>, magic links have been sent to all linked email addresses.</p>
        <button
          onClick={() => {
            setRecoverySent(false)
            setIsRecovery(false)
            setEmail('')
          }}
          className="secondary-button"
        >
          Back to sign in
        </button>
      </div>
    )
  }

  if (isSubmitted && !error) {
    return (
      <div className="login-form success">
        <h2>Check your email!</h2>
        <p>We've sent a magic link to <strong>{email}</strong></p>
        <p>Click the link in your email to sign in.</p>
        <button
          onClick={() => {
            setIsSubmitted(false)
            setEmail('')
          }}
          className="secondary-button"
        >
          Send another link
        </button>
      </div>
    )
  }

  if (isRecovery) {
    return (
      <div className="login-form">
        <h2>Account Recovery</h2>
        <p className="form-description">Enter an email linked to your account. Magic links will be sent to <strong>all</strong> email addresses on that account.</p>
        <form onSubmit={handleRecover}>
          <div className="form-group">
            <label htmlFor="recovery-email">Email address</label>
            <input
              id="recovery-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !email}
            className="primary-button"
          >
            {isLoading ? 'Sending...' : 'Send recovery links'}
          </button>
        </form>

        <div className="form-footer">
          <button
            onClick={() => { setIsRecovery(false); clearError() }}
            className="link-button"
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-form">
      <h2>Sign in to CleanCentive</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            disabled={isLoading}
          />
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || !email || !guestReady}
          className="primary-button"
        >
          {isLoading ? 'Sending...' : 'Send magic link'}
        </button>
      </form>

      <div className="form-footer">
        <p>No password required. We'll email you a secure link to sign in.</p>
        <button
          onClick={() => { setIsRecovery(true); clearError() }}
          className="link-button"
        >
          Can't access your email? Recover account
        </button>
      </div>
    </div>
  )
}
