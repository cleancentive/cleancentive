import { useAuthStore } from '../stores/authStore'

export const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

/**
 * Bearer header for the current identity, whichever it is.
 *
 * A guest carries a signed token too, so the routes a visitor may use — log a
 * pick, read their own history, delete their own data — authenticate the same
 * way an account does. They used to pass a `guestId` parameter instead, which
 * anyone could set to somebody else's public user id.
 */
export function getAuthHeaders(): Record<string, string> {
  const { sessionToken, guestToken } = useAuthStore.getState()
  const token = sessionToken ?? guestToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function spotThumbnailUrl(spotId: string): string {
  return `${API_BASE}/spots/${spotId}/thumbnail`
}

export function spotOriginalUrl(spotId: string): string {
  return `${API_BASE}/spots/${spotId}/image`
}
