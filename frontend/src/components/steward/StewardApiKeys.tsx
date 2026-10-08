import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { API_BASE, getAuthHeaders } from '../../lib/apiBase'
import { useCopyToClipboard } from '../../lib/useCopyToClipboard'
import { ConfirmDialog } from '../ConfirmDialog'

type ApiKeyScope = 'read' | 'write:spots'
const ALL_SCOPES: ApiKeyScope[] = ['read', 'write:spots']

interface ApiKeySummary {
  id: string
  name: string
  keyPrefix: string
  scopes: ApiKeyScope[]
  rateLimitPerMinute: number
  contactEmail: string
  spotCount: number
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

type ExpiryChoice = '30' | '365' | 'never'
const EXPIRY_CHOICES: ExpiryChoice[] = ['30', '365', 'never']

const DEFAULT_FORM = { name: '', contactEmail: '', scopes: ['read', 'write:spots'] as ApiKeyScope[], rateLimitPerMinute: 60, expiry: '365' as ExpiryChoice }

function formatDate(iso: string | null, locale: string): string {
  return iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}

export function StewardApiKeys() {
  const { t, i18n } = useTranslation(['steward', 'common'])
  const { copiedValue, copy } = useCopyToClipboard()
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeySummary | null>(null)

  const loadKeys = useCallback(async () => {
    try {
      const response = await axios.get<ApiKeySummary[]>(`${API_BASE}/admin/api-keys`, { headers: getAuthHeaders() })
      setKeys(response.data)
    } catch {
      setError(t('apiKeys.error'))
    }
  }, [t])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const toggleScope = (scope: ApiKeyScope) =>
    setForm((current) => ({
      ...current,
      scopes: current.scopes.includes(scope) ? current.scopes.filter((s) => s !== scope) : [...current.scopes, scope],
    }))

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    setIsBusy(true)
    setError(null)
    try {
      const response = await axios.post<{ key: string }>(
        `${API_BASE}/admin/api-keys`,
        {
          name: form.name.trim(),
          contactEmail: form.contactEmail.trim(),
          scopes: form.scopes,
          rateLimitPerMinute: form.rateLimitPerMinute,
          expiresInDays: form.expiry === 'never' ? null : Number(form.expiry),
        },
        { headers: getAuthHeaders() },
      )
      setCreatedKey(response.data.key)
      setForm(DEFAULT_FORM)
      await loadKeys()
    } catch (err) {
      setError(axios.isAxiosError(err) && err.response?.data?.message ? String(err.response.data.message) : t('apiKeys.error'))
    } finally {
      setIsBusy(false)
    }
  }

  const handleRevoke = async (key: ApiKeySummary) => {
    setKeyToRevoke(null)
    setIsBusy(true)
    setError(null)
    try {
      await axios.delete(`${API_BASE}/admin/api-keys/${key.id}`, { headers: getAuthHeaders() })
      await loadKeys()
    } catch {
      setError(t('apiKeys.error'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <>
      <fieldset className="page-card" disabled={isBusy}>
        <legend>{t('apiKeys.legend')}</legend>
        <p className="calendar-hint">{t('apiKeys.hint')}</p>

        {keys === null ? (
          <p className="loading">{t('apiKeys.loading')}</p>
        ) : keys.length === 0 ? (
          <p className="access-tokens-empty">{t('apiKeys.empty')}</p>
        ) : (
          <div className="steward-api-keys-table">
            <table className="ops-version-table">
              <thead>
                <tr>
                  <th>{t('apiKeys.columns.name')}</th>
                  <th>{t('apiKeys.columns.prefix')}</th>
                  <th>{t('apiKeys.columns.scopes')}</th>
                  <th>{t('apiKeys.columns.rateLimit')}</th>
                  <th>{t('apiKeys.columns.contact')}</th>
                  <th>{t('apiKeys.columns.spots')}</th>
                  <th>{t('apiKeys.columns.lastUsed')}</th>
                  <th>{t('apiKeys.columns.expires')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className={key.revokedAt ? 'steward-api-key--revoked' : undefined}>
                    <td>{key.name}</td>
                    <td><code>{key.keyPrefix}…</code></td>
                    <td>{key.scopes.join(', ')}</td>
                    <td>{key.rateLimitPerMinute}/min</td>
                    <td>{key.contactEmail}</td>
                    <td>{key.spotCount.toLocaleString()}</td>
                    <td>{formatDate(key.lastUsedAt, i18n.language)}</td>
                    <td>{key.expiresAt ? formatDate(key.expiresAt, i18n.language) : t('apiKeys.noExpiry')}</td>
                    <td>
                      {key.revokedAt ? (
                        <span className="access-token-prefix">{t('apiKeys.revoked')}</span>
                      ) : (
                        <button type="button" className="secondary-button" onClick={() => setKeyToRevoke(key)}>
                          {t('apiKeys.revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <div className="error-message">{error}</div>}
      </fieldset>

      <fieldset className="page-card" disabled={isBusy}>
        <legend>{t('apiKeys.create')}</legend>
        <form onSubmit={handleCreate} className="steward-api-key-form">
          <label>
            {t('apiKeys.nameField')}
            <input type="text" value={form.name} maxLength={100} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t('apiKeys.contactField')}
            <input type="email" value={form.contactEmail} required onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </label>
          <div className="steward-api-key-scopes">
            <span>{t('apiKeys.scopesField')}</span>
            {ALL_SCOPES.map((scope) => (
              <label key={scope} className="email-checkbox">
                <input type="checkbox" checked={form.scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                <span>{scope}</span>
              </label>
            ))}
          </div>
          <label>
            {t('apiKeys.rateLimitField')}
            <input
              type="number"
              min={1}
              max={6000}
              value={form.rateLimitPerMinute}
              onChange={(e) => setForm({ ...form, rateLimitPerMinute: Number(e.target.value) })}
            />
          </label>
          <label>
            {t('apiKeys.expiresField')}
            <select value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value as ExpiryChoice })}>
              {EXPIRY_CHOICES.map((choice) => (
                <option key={choice} value={choice}>{t(`apiKeys.expires_${choice}`)}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="secondary-button"
            disabled={isBusy || !form.name.trim() || !form.contactEmail.trim() || form.scopes.length === 0}
          >
            {t('apiKeys.create')}
          </button>
        </form>
      </fieldset>

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
    </>
  )
}
