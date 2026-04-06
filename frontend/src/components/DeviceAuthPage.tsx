import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export function DeviceAuthPage() {
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
      setError(err.response?.data?.message || 'Failed to approve device code')
      setStatus('error')
    }
  }

  if (!sessionToken) {
    return (
      <div style={{ maxWidth: 440, margin: '4rem auto', textAlign: 'center' }}>
        <h2>Device Authentication</h2>
        <p>Sign in to approve this device code.</p>
        <button className="primary-button" style={{ marginTop: '1rem' }} onClick={openSignInModal}>
          Sign in
        </button>
      </div>
    )
  }

  if (status === 'approved') {
    return (
      <div style={{ maxWidth: 440, margin: '4rem auto', textAlign: 'center' }}>
        <h2>Device Approved</h2>
        <p style={{ fontSize: '1.1rem', color: 'var(--color-success)' }}>
          Authenticated as <strong>{user?.nickname}</strong>. You can close this tab.
        </p>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <div style={{ maxWidth: 440, margin: '4rem auto', textAlign: 'center' }}>
        <h2>Device Rejected</h2>
        <p>The device code was not approved. You can close this tab.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 440, margin: '4rem auto', textAlign: 'center' }}>
      <h2>Device Authentication</h2>
      <p>A CLI tool is requesting access to your <strong>{user?.nickname}</strong> account.</p>
      <p style={{ fontSize: '2rem', fontFamily: 'monospace', letterSpacing: '0.3em', margin: '1.5rem 0' }}>
        {code || '------'}
      </p>
      <p>Verify this code matches what your terminal shows.</p>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
        <button
          className="primary-button"
          style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}
          onClick={handleApprove}
          disabled={!code || status === 'approving'}
        >
          {status === 'approving' ? 'Approving...' : 'Approve'}
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
          Reject
        </button>
      </div>
    </div>
  )
}
