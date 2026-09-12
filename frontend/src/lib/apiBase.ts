import { useAuthStore } from '../stores/authStore'

export const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export function getAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().sessionToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function spotThumbnailUrl(spotId: string): string {
  return `${API_BASE}/spots/${spotId}/thumbnail`
}

export function spotOriginalUrl(spotId: string): string {
  return `${API_BASE}/spots/${spotId}/image`
}
