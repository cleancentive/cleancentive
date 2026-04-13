import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'

/**
 * OIDC authorize hand-off page.
 *
 * The backend redirects unauthenticated SSO flows here (with the original
 * OIDC query string intact) because a top-level navigation from an external
 * client (e.g. Outline) can't carry the frontend's Bearer session token.
 *
 * - If we have a session, POST the OIDC params to the backend to mint an
 *   authorization code and navigate to the client's redirect URI.
 * - If we don't, open the sign-in modal and wait for the user to log in.
 *   Once the auth store updates, this effect re-runs and completes the flow.
 */
export function OidcAuthorize() {
  const location = useLocation()
  const sessionToken = useAuthStore((s) => s.sessionToken)
  const openSignInModal = useUiStore((s) => s.openSignInModal)
  const [error, setError] = useState<string | null>(null)
  const completingRef = useRef(false)

  useEffect(() => {
    if (!sessionToken) {
      openSignInModal()
      return
    }
    if (completingRef.current) return
    completingRef.current = true

    const params = new URLSearchParams(location.search)
    const body = Object.fromEntries(params.entries())

    ;(async () => {
      try {
        const res = await fetch('/api/v1/oidc/authorize/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`)
        }
        const { redirectUrl } = (await res.json()) as { redirectUrl: string }
        window.location.replace(redirectUrl)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        completingRef.current = false
      }
    })()
  }, [sessionToken, location.search, openSignInModal])

  if (error) {
    return (
      <div className="p-4">
        <h2>Sign-in handoff failed</h2>
        <p>{error}</p>
      </div>
    )
  }

  if (!sessionToken) {
    return <div className="p-4">Please sign in to continue to the wiki…</div>
  }

  return <div className="p-4">Signing you in to the wiki…</div>
}
