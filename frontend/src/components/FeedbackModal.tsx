import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFeedbackStore } from '../stores/feedbackStore'
import { useAuthStore } from '../stores/authStore'

export function FeedbackModal() {
  const { isModalOpen, isSubmitting, isSubmitted, error, prefilled, closeFeedbackModal, submitFeedback } = useFeedbackStore()
  const { user } = useAuthStore()

  const [category, setCategory] = useState<string>('bug')
  const [description, setDescription] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [includeContact, setIncludeContact] = useState(true)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    if (prefilled) {
      if (prefilled.category) setCategory(prefilled.category)
      if (prefilled.description) setDescription(prefilled.description)
    }
  }, [prefilled])

  useEffect(() => {
    if (!isModalOpen) {
      setCategory('bug')
      setDescription('')
      setContactEmail('')
      setIncludeContact(true)
      setShowDetails(false)
    }
  }, [isModalOpen])

  useEffect(() => {
    if (!isModalOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFeedbackModal()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen, closeFeedbackModal])

  if (!isModalOpen) return null

  const userEmail = user?.emails?.[0]?.email
  const resolvedContactEmail = user ? (includeContact ? userEmail : undefined) : (contactEmail.trim() || undefined)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitFeedback({
      category,
      description: description.trim(),
      contactEmail: resolvedContactEmail,
      errorContext: prefilled?.errorContext,
    })
  }

  return (
    <div className="sign-in-overlay" onClick={closeFeedbackModal}>
      <div className="sign-in-dialog feedback-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="sign-in-close" onClick={closeFeedbackModal} aria-label="Close">
          ×
        </button>

        {isSubmitted ? (
          <div className="feedback-success">
            <h2>Thank you!</h2>
            <p>Your feedback has been sent. You can track it in your <Link to="/feedback" onClick={closeFeedbackModal}>feedback history</Link>.</p>
          </div>
        ) : (
          <>
            <h2>Send Feedback</h2>
            <p className="feedback-privacy">This is a private message to the CleanCentive stewards. Only you and the stewards can see it.</p>

            <form onSubmit={handleSubmit}>
              <label>
                Category
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="bug">Bug</option>
                  <option value="suggestion">Suggestion</option>
                  <option value="question">Question</option>
                </select>
              </label>

              <label>
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell us what happened or what you'd like to see..."
                  rows={4}
                  required
                  minLength={10}
                  maxLength={2000}
                />
              </label>

              {user ? (
                <label className="feedback-contact-toggle">
                  <input
                    type="checkbox"
                    checked={includeContact}
                    onChange={(e) => setIncludeContact(e.target.checked)}
                  />
                  You can contact me at {userEmail}
                </label>
              ) : (
                <label>
                  Email (optional, for follow-up)
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="your@email.com"
                  />
                </label>
              )}

              {prefilled?.errorContext && (
                <div className="feedback-error-context">
                  <button type="button" className="link-button" onClick={() => setShowDetails(!showDetails)}>
                    {showDetails ? 'Hide' : 'Show'} technical details
                  </button>
                  {showDetails && (
                    <pre className="feedback-error-details">
                      {JSON.stringify(prefilled.errorContext, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {error && <p className="error-message">{error}</p>}

              <div className="form-actions">
                <button type="submit" className="primary-button" disabled={isSubmitting || description.trim().length < 10}>
                  {isSubmitting ? 'Sending...' : 'Send Feedback'}
                </button>
                <button type="button" className="secondary-button" onClick={closeFeedbackModal}>
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
