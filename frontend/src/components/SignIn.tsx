import { useEffect, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'

const lastUsedEmailStorageKey = 'lastUsedSignInEmail'

export function SignIn() {
  const { t } = useTranslation(['auth', 'common'])
  const [email, setEmail] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isRecovery, setIsRecovery] = useState(false)
  const [recoverySent, setRecoverySent] = useState(false)
  const { login, recoverAccount, isLoading, error, clearError } = useAuthStore()
  const { isOnline } = useConnectivityStore()

  useEffect(() => {
    const lastUsedEmail = localStorage.getItem(lastUsedEmailStorageKey)
    if (lastUsedEmail) {
      setEmail(lastUsedEmail)
    }
  }, [])

  const updateEmail = (value: string) => {
    setEmail(value)
    const trimmedValue = value.trim()
    if (trimmedValue) {
      localStorage.setItem(lastUsedEmailStorageKey, trimmedValue)
      return
    }

    localStorage.removeItem(lastUsedEmailStorageKey)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await login(email)
      localStorage.setItem(lastUsedEmailStorageKey, email.trim())
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
      localStorage.setItem(lastUsedEmailStorageKey, email.trim())
      setRecoverySent(true)
    } catch {
      // Error is handled by the store
    }
  }

  if (recoverySent && !error) {
    return (
      <div className="login-form success">
        <h2>{t('recoverySent.title')}</h2>
        <p><Trans t={t} i18nKey="recoverySent.body" values={{ email }} components={{ strong: <strong /> }} /></p>
        <button
          onClick={() => {
            setRecoverySent(false)
            setIsRecovery(false)
            setEmail(localStorage.getItem(lastUsedEmailStorageKey) || '')
          }}
          className="secondary-button"
        >
          {t('recoverySent.backToSignIn')}
        </button>
      </div>
    )
  }

  if (isSubmitted && !error) {
    return (
      <div className="login-form success">
        <h2>{t('magicLinkSent.title')}</h2>
        <p><Trans t={t} i18nKey="magicLinkSent.body" values={{ email }} components={{ strong: <strong /> }} /></p>
        <p>{t('magicLinkSent.instructions')}</p>
        <button
          onClick={() => {
            setIsSubmitted(false)
            setEmail(localStorage.getItem(lastUsedEmailStorageKey) || '')
          }}
          className="secondary-button"
        >
          {t('magicLinkSent.sendAnother')}
        </button>
      </div>
    )
  }

  if (isRecovery) {
    return (
      <div className="login-form">
        <h2>{t('recovery.title')}</h2>
        <p className="form-description"><Trans t={t} i18nKey="recovery.description" components={{ strong: <strong /> }} /></p>
        <form onSubmit={handleRecover}>
          <div className="form-group">
            <label htmlFor="recovery-email">{t('signIn.emailLabel')}</label>
            <input
              id="recovery-email"
              type="email"
              value={email}
              onChange={(e) => updateEmail(e.target.value)}
              placeholder={t('signIn.emailPlaceholder')}
              required
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {!isOnline && <p className="offline-banner">{t('signIn.offlineNotice')}</p>}

          <button
            type="submit"
            disabled={!isOnline || isLoading || !email}
            className="primary-button"
          >
            {isLoading ? t('signIn.sending') : t('recovery.sendLinks')}
          </button>
        </form>

        <div className="form-footer">
          <button
            onClick={() => { setIsRecovery(false); clearError() }}
            className="link-button"
          >
            {t('recovery.backToSignIn')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-form">
      <h2>{t('signIn.welcomeTitle')}</h2>
      <p className="form-description">{t('signIn.welcomeDescription')}</p>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
            <label htmlFor="email">{t('signIn.emailLabel')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => updateEmail(e.target.value)}
              placeholder={t('signIn.emailPlaceholder')}
              required
              disabled={isLoading}
          />
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {!isOnline && <p className="offline-banner">{t('signIn.offlineNotice')}</p>}

        <button
          type="submit"
          disabled={!isOnline || isLoading || !email}
          className="primary-button"
        >
          {isLoading ? t('signIn.sending') : t('signIn.sendMagicLink')}
        </button>
      </form>

      <div className="form-footer">
        <p>{t('signIn.noPasswordHint')}</p>
        <button
          onClick={() => { setIsRecovery(true); clearError() }}
          className="link-button"
        >
          {t('signIn.recoverPrompt')}
        </button>
      </div>
    </div>
  )
}
