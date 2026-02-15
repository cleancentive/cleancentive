import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)
  const { login, isLoading, error, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await login(email)
      setIsSubmitted(true)
    } catch (error) {
      // Error is handled by the store
    }
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
          disabled={isLoading || !email}
          className="primary-button"
        >
          {isLoading ? 'Sending...' : 'Send magic link'}
        </button>
      </form>

      <div className="form-footer">
        <p>No password required. We'll email you a secure link to sign in.</p>
      </div>
    </div>
  )
}