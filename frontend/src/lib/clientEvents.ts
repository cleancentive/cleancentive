import { useAuthStore } from '../stores/authStore'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export type ClientEventType =
  | 'pick.upload.failed'
  | 'pick.upload.skipped.identity-mismatch'

export type IdentityHint = 'matches' | 'mismatch' | 'no-current-identity'

interface UploadFailedEvent {
  eventType: 'pick.upload.failed'
  itemId: string
  attempts: number
  ageMs: number
  status: number | null
  message: string
}

interface IdentityMismatchEvent {
  eventType: 'pick.upload.skipped.identity-mismatch'
  itemId: string
  attempts: number
  ageMs: number
  identityHint: IdentityHint
}

export type ClientEventInput = UploadFailedEvent | IdentityMismatchEvent

const MAX_MESSAGE_LENGTH = 256

export function reportClientEvent(input: ClientEventInput): void {
  const occurredAt = new Date().toISOString()
  const sessionToken = useAuthStore.getState().sessionToken
  const guestId = useAuthStore.getState().guestId

  const body: Record<string, unknown> = {
    eventType: input.eventType,
    occurredAt,
    itemId: input.itemId,
    attempts: input.attempts,
    ageMs: input.ageMs,
  }

  if (input.eventType === 'pick.upload.failed') {
    body.status = input.status
    body.message = input.message.slice(0, MAX_MESSAGE_LENGTH)
  } else {
    body.identityHint = input.identityHint
  }

  if (!sessionToken && guestId) {
    body.guestId = guestId
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`
  }

  // Best-effort, never throw, never retry, never queue.
  void fetch(`${API_BASE}/client-events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}
