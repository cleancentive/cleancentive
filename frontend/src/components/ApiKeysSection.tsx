import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { API_BASE, getAuthHeaders } from '../lib/apiBase'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useCopyToClipboard } from '../lib/useCopyToClipboard'
import { ConfirmDialog } from './ConfirmDialog'

type ApiKeyScope = 'read' | 'write:spots'
const ALL_SCOPES: ApiKeyScope[] = ['read', 'write:spots']

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: ApiKeyScope[]
  rateLimitPerMinute: number
  spotCount: number
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

type ExpiryChoice = '30' | '365' | 'never'
const EXPIRY_CHOICES: ExpiryChoice[] = ['30', '365', 'never']
const DEFAULT_EXPIRY: ExpiryChoice = '365'

function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** A developer's own API keys: one per app, created and revoked here, budget raised by a steward. */
export function ApiKeysSection() {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const { isOnline } = useConnectivityStore()
  const { copiedValue, copy } = useCopyToClipboard()

  const [keys, setKeys] = useState<ApiKey[]>([])
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiKeyScope[]>(ALL_SCOPES)
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null)

  const loadKeys = useCallback(async () => {
    try {
      const response = await axios.get<ApiKey[]>(`${API_BASE}/user/api-keys`, { headers: getAuthHeaders() })
      setKeys(response.data)
    } catch {
      setError(t('apiKeys.error'))
    }
  }, [t])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  // /profile#api-keys is the deep link in the developer docs; the section renders
  // after the profile loads, so the browser's own anchor jump has nothing to hit.
  useEffect(() => {
    if (window.location.hash === '#api-keys') {
      document.getElementById('api-keys')?.scrollIntoView({ block: 'start' })
    }
  }, [])

  const toggleScope = (scope: ApiKeyScope) =>
    setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]))

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    setIsBusy(true)
    setError(null)
    try {
      const response = await axios.post<ApiKey & { key: string }>(
        `${API_BASE}/user/api-keys`,
        { name: name.trim(), scopes, expiresInDays: expiry === 'never' ? null : Number(expiry) },
        { headers: getAuthHeaders() },
      )
      setCreatedKey(response.data.key)
      setName('')
      setScopes(ALL_SCOPES)
      setExpiry(DEFAULT_EXPIRY)
      await loadKeys()
    } catch (err) {
      setError(axios.isAxiosError(err) && err.response?.data?.message ? String(err.response.data.message) : t('apiKeys.error'))
    } finally {
      setIsBusy(false)
    }
  }

  const handleRevoke = async (key: ApiKey) => {
    setKeyToRevoke(null)
    setIsBusy(true)
    setError(null)
    try {
      await axios.delete(`${API_BASE}/user/api-keys/${key.id}`, { headers: getAuthHeaders() })
      await loadKeys()
    } catch {
      setError(t('apiKeys.error'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <fieldset id="api-keys" className="page-card access-tokens" disabled={!isOnline || isBusy}>
      <legend>{t('apiKeys.legend')}</legend>
      <p className="calendar-hint">{t('apiKeys.hint')}</p>

      {keys.length === 0 ? (
        <p className="access-tokens-empty">{t('apiKeys.empty')}</p>
      ) : (
        <ul className="access-token-list">
          {keys.map((key) => {
            const lastUsed = formatDate(key.lastUsedAt, i18n.language)
            const expires = formatDate(key.expiresAt, i18n.language)
            return (
              <li key={key.id} className="access-token-item">
                <div className="access-token-main">
                  <span className="access-token-name">{key.name}</span>
                  <code className="access-token-prefix">{key.keyPrefix}…</code>
                </div>
                <div className="access-token-meta">
                  <span>{key.scopes.join(', ')}</span>
                  <span>{t('apiKeys.budget', { count: key.rateLimitPerMinute })}</span>
                  <span>{t('apiKeys.picks', { count: key.spotCount })}</span>
                  <span>{lastUsed ? t('apiKeys.lastUsed', { date: lastUsed }) : t('apiKeys.neverUsed')}</span>
                  <span>{expires ? t('apiKeys.expiresOn', { date: expires }) : t('apiKeys.noExpiry')}</span>
                </div>
                <button
                  type="button"
                  className="remove-email-button"
                  title={t('apiKeys.revoke')}
                  onClick={() => setKeyToRevoke(key)}
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
          placeholder={t('apiKeys.namePlaceholder')}
          maxLength={100}
          required
        />
        <span className="api-key-scopes" role="group" aria-label={t('apiKeys.scopesField')}>
          {ALL_SCOPES.map((scope) => (
            <label key={scope} className="email-checkbox">
              <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
              <span>{scope}</span>
            </label>
          ))}
        </span>
        <select value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryChoice)} aria-label={t('apiKeys.expiresField')}>
          {EXPIRY_CHOICES.map((choice) => (
            <option key={choice} value={choice}>{t(`apiKeys.expires_${choice}`)}</option>
          ))}
        </select>
        <button type="submit" className="secondary-button" disabled={!isOnline || isBusy || !name.trim() || scopes.length === 0}>
          {t('apiKeys.create')}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {createdKey && (
        <ConfirmDialog title={t('apiKeys.createdTitle')} actions={
          <>
            <button type="button" className="secondary-button" onClick={() => copy(createdKey)}>
              {copiedValue === createdKey ? t('apiKeys.copied') : t('common:actions.copy')}
            </button>
            <button type="button" className="secondary-button" onClick={() => setCreatedKey(null)}>
              {t('apiKeys.done')}
            </button>
          </>
        }>
          <p>{t('apiKeys.createdBody')}</p>
          <code className="calendar-feed-url access-token-value">{createdKey}</code>
        </ConfirmDialog>
      )}

      {keyToRevoke && (
        <ConfirmDialog title={t('apiKeys.revokeTitle')} actions={
          <>
            <button type="button" className="danger-button" onClick={() => handleRevoke(keyToRevoke)}>
              {t('apiKeys.revoke')}
            </button>
            <button type="button" className="secondary-button" onClick={() => setKeyToRevoke(null)}>
              {t('common:actions.cancel')}
            </button>
          </>
        }>
          <p>{t('apiKeys.revokeBody', { name: keyToRevoke.name })}</p>
        </ConfirmDialog>
      )}
    </fieldset>
  )
}
