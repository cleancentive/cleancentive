import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { API_BASE, getAuthHeaders } from '../lib/apiBase'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useCopyToClipboard } from '../lib/useCopyToClipboard'
import { ConfirmDialog } from './ConfirmDialog'

interface AccessToken {
  id: string
  name: string
  tokenPrefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

type ExpiryChoice = '30' | '90' | '365' | 'never'
const EXPIRY_CHOICES: ExpiryChoice[] = ['30', '90', '365', 'never']
const DEFAULT_EXPIRY: ExpiryChoice = '90'

function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function AccessTokensSection() {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const { isOnline } = useConnectivityStore()
  const { copiedValue, copy } = useCopyToClipboard()

  const [tokens, setTokens] = useState<AccessToken[]>([])
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [tokenToRevoke, setTokenToRevoke] = useState<AccessToken | null>(null)

  const loadTokens = useCallback(async () => {
    try {
      const response = await axios.get<AccessToken[]>(`${API_BASE}/user/tokens`, { headers: getAuthHeaders() })
      setTokens(response.data)
    } catch {
      setError(t('tokens.error'))
    }
  }, [t])

  useEffect(() => {
    void loadTokens()
  }, [loadTokens])

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    setIsBusy(true)
    setError(null)
    try {
      const response = await axios.post<AccessToken & { token: string }>(
        `${API_BASE}/user/tokens`,
        { name: name.trim(), expiresInDays: expiry === 'never' ? null : Number(expiry) },
        { headers: getAuthHeaders() },
      )
      setCreatedToken(response.data.token)
      setName('')
      setExpiry(DEFAULT_EXPIRY)
      await loadTokens()
    } catch (err) {
      setError(axios.isAxiosError(err) && err.response?.data?.message ? String(err.response.data.message) : t('tokens.error'))
    } finally {
      setIsBusy(false)
    }
  }

  const handleRevoke = async (token: AccessToken) => {
    setTokenToRevoke(null)
    setIsBusy(true)
    setError(null)
    try {
      await axios.delete(`${API_BASE}/user/tokens/${token.id}`, { headers: getAuthHeaders() })
      await loadTokens()
    } catch {
      setError(t('tokens.error'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <fieldset className="page-card access-tokens" disabled={!isOnline || isBusy}>
      <legend>{t('tokens.legend')}</legend>
      <p className="calendar-hint">{t('tokens.hint')}</p>

      {tokens.length === 0 ? (
        <p className="access-tokens-empty">{t('tokens.empty')}</p>
      ) : (
        <ul className="access-token-list">
          {tokens.map((token) => {
            const lastUsed = formatDate(token.lastUsedAt, i18n.language)
            const expires = formatDate(token.expiresAt, i18n.language)
            return (
              <li key={token.id} className="access-token-item">
                <div className="access-token-main">
                  <span className="access-token-name">{token.name}</span>
                  <code className="access-token-prefix">{token.tokenPrefix}…</code>
                </div>
                <div className="access-token-meta">
                  <span>{t('tokens.created', { date: formatDate(token.createdAt, i18n.language) })}</span>
                  <span>{lastUsed ? t('tokens.lastUsed', { date: lastUsed }) : t('tokens.neverUsed')}</span>
                  <span>{expires ? t('tokens.expiresOn', { date: expires }) : t('tokens.noExpiry')}</span>
                </div>
                <button
                  type="button"
                  className="remove-email-button"
                  title={t('tokens.revoke')}
                  onClick={() => setTokenToRevoke(token)}
                >
                  x
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={handleCreate} className="add-email-form access-token-form">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('tokens.namePlaceholder')}
          maxLength={100}
          required
        />
        <select value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryChoice)} aria-label={t('tokens.expiresField')}>
          {EXPIRY_CHOICES.map((choice) => (
            <option key={choice} value={choice}>{t(`tokens.expires_${choice}`)}</option>
          ))}
        </select>
        <button type="submit" className="secondary-button" disabled={!isOnline || isBusy || !name.trim()}>
          {t('tokens.create')}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {createdToken && (
        <ConfirmDialog title={t('tokens.createdTitle')} actions={
          <>
            <button type="button" className="secondary-button" onClick={() => copy(createdToken)}>
              {copiedValue === createdToken ? t('tokens.copied') : t('common:actions.copy')}
            </button>
            <button type="button" className="secondary-button" onClick={() => setCreatedToken(null)}>
              {t('tokens.done')}
            </button>
          </>
        }>
          <p>{t('tokens.createdBody')}</p>
          <code className="calendar-feed-url access-token-value">{createdToken}</code>
        </ConfirmDialog>
      )}

      {tokenToRevoke && (
        <ConfirmDialog title={t('tokens.revokeTitle')} actions={
          <>
            <button type="button" className="danger-button" onClick={() => handleRevoke(tokenToRevoke)}>
              {t('tokens.revoke')}
            </button>
            <button type="button" className="secondary-button" onClick={() => setTokenToRevoke(null)}>
              {t('common:actions.cancel')}
            </button>
          </>
        }>
          <p>{t('tokens.revokeBody', { name: tokenToRevoke.name })}</p>
        </ConfirmDialog>
      )}
    </fieldset>
  )
}
