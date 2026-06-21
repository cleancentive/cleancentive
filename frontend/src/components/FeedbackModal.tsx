import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { useFeedbackStore } from '../stores/feedbackStore'
import { useAuthStore } from '../stores/authStore'
import { useEscapeKey } from '../hooks/useEscapeKey'

export function FeedbackModal() {
  const { t } = useTranslation(['feedback', 'common'])
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

  useEscapeKey(isModalOpen, closeFeedbackModal)

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
        <button className="sign-in-close" onClick={closeFeedbackModal} aria-label={t('common:actions.close')}>
          ×
        </button>

        {isSubmitted ? (
          <div className="feedback-success">
            <h2>{t('modal.successTitle')}</h2>
            <p>
              <Trans
                t={t}
                i18nKey="modal.successBody"
                components={{ link: <Link to="/feedback" onClick={closeFeedbackModal} /> }}
              />
            </p>
          </div>
        ) : (
          <>
            <h2>{t('modal.title')}</h2>
            <p className="feedback-privacy">{t('modal.privacy')}</p>

            <form onSubmit={handleSubmit}>
              <label>
                {t('modal.categoryLabel')}
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="bug">{t('category.bug')}</option>
                  <option value="suggestion">{t('category.suggestion')}</option>
                  <option value="question">{t('category.question')}</option>
                </select>
              </label>

              <label>
                {t('modal.descriptionLabel')}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('modal.descriptionPlaceholder')}
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
                  {t('modal.contactToggle', { email: userEmail })}
                </label>
              ) : (
                <label>
                  {t('modal.emailLabel')}
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder={t('modal.emailPlaceholder')}
                  />
                </label>
              )}

              {prefilled?.errorContext && (
                <div className="feedback-error-context">
                  <button type="button" className="link-button" onClick={() => setShowDetails(!showDetails)}>
                    {showDetails ? t('modal.hideDetails') : t('modal.showDetails')}
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
                  {isSubmitting ? t('modal.sending') : t('modal.submit')}
                </button>
                <button type="button" className="secondary-button" onClick={closeFeedbackModal}>
                  {t('common:actions.cancel')}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
