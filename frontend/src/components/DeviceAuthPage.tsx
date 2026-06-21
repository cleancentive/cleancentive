import { useState, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import axios from 'axios'

import { API_BASE } from '../lib/apiBase'

export function DeviceAuthPage() {
  const { t } = useTranslation(['auth', 'common'])
  const { sessionToken, user } = useAuthStore()
  const { openSignInModal } = useUiStore()
  const [searchParams] = useSearchParams()
  const code = searchParams.get('code') || ''
  const [status, setStatus] = useState<'idle' | 'approving' | 'approved' | 'rejected' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Auto-open sign-in modal if not logged in
  useEffect(() => {
    if (!sessionToken) {
      openSignInModal()
    }
  }, [sessionToken, openSignInModal])

  const handleApprove = async () => {
    setStatus('approving')
    setError(null)
    try {
      await axios.post(
        `${API_BASE}/auth/device-code/approve`,
        { deviceCode: code },
        { headers: { Authorization: `Bearer ${sessionToken}` } },
      )
      setStatus('approved')
    } catch (err: any) {
      setError(err.response?.data?.message || t('device.approveFailed'))
      setStatus('error')
    }
  }

  if (!sessionToken) {
    return (
      <div style={{ maxWidth: 440, margin: '4rem auto', textAlign: 'center' }}>
        <h2>{t('device.title')}</h2>
        <p>{t('device.signInPrompt')}</p>
        <button className="primary-button" style={{ marginTop: '1rem' }} onClick={openSignInModal}>
          {t('common:actions.signIn')}
        </button>
      </div>
    )
  }

  if (status === 'approved') {
    return (
      <div style={{ maxWidth: 440, margin: '4rem auto', textAlign: 'center' }}>
        <h2>{t('device.approvedTitle')}</h2>
        <p style={{ fontSize: '1.1rem', color: 'var(--color-success)' }}>
          <Trans t={t} i18nKey="device.approvedBody" values={{ nickname: user?.nickname }} components={{ strong: <strong /> }} />
        </p>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <div style={{ maxWidth: 440, margin: '4rem auto', textAlign: 'center' }}>
        <h2>{t('device.rejectedTitle')}</h2>
        <p>{t('device.rejectedBody')}</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 440, margin: '4rem auto', textAlign: 'center' }}>
      <h2>{t('device.title')}</h2>
      <p><Trans t={t} i18nKey="device.requestBody" values={{ nickname: user?.nickname }} components={{ strong: <strong /> }} /></p>
      <p style={{ fontSize: '2rem', fontFamily: 'monospace', letterSpacing: '0.3em', margin: '1.5rem 0' }}>
        {code || '------'}
      </p>
      <p>{t('device.verifyCode')}</p>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
        <button
          className="primary-button"
          style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}
          onClick={handleApprove}
          disabled={!code || status === 'approving'}
        >
          {status === 'approving' ? t('device.approving') : t('device.approve')}
        </button>
        <button
          className="secondary-button"
          style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}
          onClick={async () => {
            try {
              await axios.post(`${API_BASE}/auth/device-code/reject`, { deviceCode: code })
            } catch { /* best-effort */ }
            setStatus('rejected')
          }}
          disabled={status === 'approving'}
        >
          {t('device.reject')}
        </button>
      </div>
    </div>
  )
}
