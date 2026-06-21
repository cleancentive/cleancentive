import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'
import { v7 as uuidv7 } from 'uuid'
import { useUiStore } from './uiStore'
import { trackEvent, identifyUser } from '../lib/analytics'
import { API_BASE, getAuthHeaders } from '../lib/apiBase'

interface UserEmail {
  id: string
  email: string
  is_selected_for_login: boolean
  calendar_emails_enabled: boolean
}

interface User {
  id: string
  nickname: string
  full_name?: string
  locale?: string | null
  avatar_email_id?: string | null
  uploaded_avatar_key?: string | null
  uploaded_avatar_updated_at?: string | null
  emails: UserEmail[]
  active_team_id?: string | null
  active_cleanup_date_id?: string | null
  active_team_name?: string | null
  active_team_is_partner?: boolean
  active_team_custom_css?: string | null
  active_cleanup_name?: string | null
  active_cleanup_location?: string | null
  active_cleanup_start_at?: string | null
  active_cleanup_end_at?: string | null
}

interface AuthState {
  user: User | null
  sessionToken: string | null
  guestId: string | null
  isLoading: boolean
  error: string | null
  guestReady: boolean
  // requestId this tab is currently polling for, if any. Used as the binding
  // key for the cross-tab BroadcastChannel sign-in: only a broadcast carrying
  // *this exact* requestId applies the session here. Each independent sign-in
  // attempt (a separate POST /auth/magic-link) gets its own requestId and
  // must be resolved by its own link.
  pendingAuthRequestId: string | null

  // Actions
  initializeGuest: () => Promise<void>
  login: (email: string) => Promise<void>
  verifyMagicLink: (token: string) => Promise<void>
  cancelPendingAuth: () => void
  logout: () => void
  updateProfile: (data: { nickname?: string; full_name?: string | null; locale?: string | null }) => Promise<void>
  addEmail: (email: string) => Promise<{ status: string; ownerNickname?: string }>
  confirmMerge: (email: string) => Promise<boolean>
  removeEmail: (emailId: string) => Promise<void>
  updateEmailSelection: (emailIds: string[]) => Promise<void>
  updateAvatarEmail: (emailId: string | null) => Promise<void>
  uploadAvatar: (file: File) => Promise<void>
  removeUploadedAvatar: () => Promise<void>
  updateCalendarEmailSelection: (emailIds: string[]) => Promise<void>
  getCalendarUrls: () => Promise<{ joinedHttp: string; joinedWebcal: string; discoverHttp: string; discoverWebcal: string } | null>
  deleteAccount: () => Promise<void>
  anonymizeAccount: () => Promise<void>
  deleteGuestData: (mode: 'delete' | 'anonymize') => Promise<void>
  recoverAccount: (email: string) => Promise<void>
  refreshProfile: () => Promise<void>
  refreshTokenIfNeeded: () => Promise<void>
  clearError: () => void
}

function selectedEmails(user: User): string[] {
  return user.emails.filter(e => e.is_selected_for_login).map(e => e.email)
}

// Module-level polling handles (not in Zustand state — not serializable)
let pollIntervalId: ReturnType<typeof setInterval> | null = null
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null

function clearPolling() {
  if (pollIntervalId !== null) { clearInterval(pollIntervalId); pollIntervalId = null }
  if (pollTimeoutId !== null) { clearTimeout(pollTimeoutId); pollTimeoutId = null }
}

// BroadcastChannel: when one tab signs in via magic link, sibling tabs in the
// same browser profile receive the session instantly instead of waiting for
// their 2s poll cycle. Same-origin same-profile — no cross-browser leak.
const AUTH_CHANNEL_NAME = 'cleancentive-auth'
const TITLE_FLASH_MS = 3000

let authChannel: BroadcastChannel | null = null
let originalTitle: string | null = null
let titleFlashTimer: ReturnType<typeof setTimeout> | null = null

function getAuthChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!authChannel) authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME)
  return authChannel
}

function flashTitle(): void {
  if (typeof document === 'undefined') return
  if (titleFlashTimer) clearTimeout(titleFlashTimer)
  if (originalTitle === null) originalTitle = document.title
  document.title = '✓ Signed in — ' + originalTitle
  titleFlashTimer = setTimeout(() => {
    if (originalTitle !== null) document.title = originalTitle
    originalTitle = null
    titleFlashTimer = null
  }, TITLE_FLASH_MS)
}

interface BroadcastSessionMessage {
  type: 'session'
  // The pending auth requestId this sign-in completed. Only a sibling tab that
  // was polling for *this exact* requestId may apply the session.
  requestId: string
  sessionToken: string
  user: User
}

function startPolling(
  requestId: string,
  get: () => AuthState,
  set: (partial: Partial<AuthState>) => void,
) {
  clearPolling()

  // Auto-stop polling after 24h (matches magic link expiry)
  pollTimeoutId = setTimeout(clearPolling, 24 * 60 * 60 * 1000)

  pollIntervalId = setInterval(async () => {
    // Stop if the user has already logged in (e.g. they clicked the link in this browser too)
    if (get().sessionToken) {
      clearPolling()
      return
    }

    try {
      const response = await axios.get(`${API_BASE}/auth/pending/${requestId}`)
      if (response.data.status === 'completed') {
        clearPolling()
        const sessionToken = response.data.sessionToken as string
        const profileResponse = await axios.get(`${API_BASE}/user/profile`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        })
        set({
          user: profileResponse.data,
          sessionToken,
          guestId: null,
          isLoading: false,
          pendingAuthRequestId: null,
        })
        identifyUser((profileResponse.data as User).id, selectedEmails(profileResponse.data as User))
        localStorage.removeItem('guestId')
      }
    } catch (error: any) {
      // 404 means expired/consumed — stop polling silently
      if (error.response?.status === 404) {
        clearPolling()
        set({ pendingAuthRequestId: null })
      }
      // Other errors: keep polling
    }
  }, 2000)
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionToken: null,
      guestId: null,
      isLoading: false,
      error: null,
      guestReady: false,
      pendingAuthRequestId: null,

      initializeGuest: async () => {
        // If already authenticated, skip guest initialization
        if (get().sessionToken && get().user) {
          const user = get().user!
          identifyUser(user.id, selectedEmails(user))
          set({ guestReady: true })
          return
        }

        const existingGuestId = get().guestId || localStorage.getItem('guestId')
        if (existingGuestId) {
          localStorage.setItem('guestId', existingGuestId)
          set({ guestId: existingGuestId, guestReady: true })
          return
        }

        // Generate a client-side UUIDv7 — no server call needed.
        // The DB row is created lazily on the first write (e.g., claiming via magic link).
        const newGuestId = uuidv7()
        localStorage.setItem('guestId', newGuestId)
        set({ guestId: newGuestId, guestReady: true })
      },

      login: async (email: string) => {
        set({ isLoading: true, error: null })
        clearPolling()

        try {
          let { guestId } = get()
          if (!guestId) {
            guestId = uuidv7()
            localStorage.setItem('guestId', guestId)
            set({ guestId, guestReady: true })
          }
          const response = await axios.post(`${API_BASE}/auth/magic-link`, { email, guestId })
          set({ isLoading: false })

          const requestId = response.data.requestId as string | undefined
          if (requestId) {
            set({ pendingAuthRequestId: requestId })
            startPolling(requestId, get, set)
          }
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to send magic link',
            isLoading: false,
          })
        }
      },

      verifyMagicLink: async (token: string) => {
        // This browser clicked the magic link — stop any active polling
        clearPolling()
        set({ isLoading: true, error: null, pendingAuthRequestId: null })

        try {
          const response = await axios.get(`${API_BASE}/auth/verify?token=${token}`)
          const sessionToken = response.headers['x-session-token']
          const completedRequestId = response.data?.requestId as string | undefined

          const profileResponse = await axios.get(`${API_BASE}/user/profile`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          })

          set({
            user: profileResponse.data,
            sessionToken,
            guestId: null,
            isLoading: false
          })

          // Tell sibling tabs in this browser they're signed in too — but only
          // if they were polling for *this exact* requestId. Each independent
          // sign-in attempt (separate POST /auth/magic-link) gets its own
          // requestId and must be resolved by its own link. Without this
          // binding, two tabs that both started a sign-in would both get
          // signed in when only one link is clicked.
          if (completedRequestId) {
            getAuthChannel()?.postMessage({
              type: 'session',
              requestId: completedRequestId,
              sessionToken,
              user: profileResponse.data,
            } satisfies BroadcastSessionMessage)
          }

          trackEvent('sign-in-completed')
          identifyUser((profileResponse.data as User).id, selectedEmails(profileResponse.data as User))
          localStorage.removeItem('guestId')
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Invalid or expired magic link',
            isLoading: false
          })
        }
      },

      cancelPendingAuth: () => {
        clearPolling()
        set({ pendingAuthRequestId: null })
      },

      logout: () => {
        clearPolling()
        set({
          user: null,
          sessionToken: null,
          guestId: null,
          guestReady: false,
          error: null,
          pendingAuthRequestId: null,
        })
        localStorage.removeItem('guestId')
        useUiStore.getState().setPickCount(0)
      },

      updateProfile: async (data: { nickname?: string; full_name?: string | null; locale?: string | null }) => {
        const { sessionToken } = get()
        if (!sessionToken) return

        set({ isLoading: true, error: null })

        try {
          const response = await axios.put(`${API_BASE}/user/profile`, data, {
            headers: getAuthHeaders()
          })

          set({
            user: response.data,
            isLoading: false
          })
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to update profile',
            isLoading: false
          })
        }
      },

      addEmail: async (email: string) => {
        const { sessionToken } = get()
        if (!sessionToken) return { status: 'error' }

        set({ isLoading: true, error: null })

        try {
          const response = await axios.post(`${API_BASE}/auth/add-email`, { email }, {
            headers: getAuthHeaders()
          })
          set({ isLoading: false })
          return response.data
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to add email',
            isLoading: false
          })
          return { status: 'error' }
        }
      },

      confirmMerge: async (email: string) => {
        const { sessionToken } = get()
        if (!sessionToken) return false

        set({ isLoading: true, error: null })

        try {
          const response = await axios.post(`${API_BASE}/auth/add-email/confirm-merge`, { email }, {
            headers: getAuthHeaders()
          })
          set({ isLoading: false })
          return response.data.sent
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to send merge request',
            isLoading: false
          })
          return false
        }
      },

      removeEmail: async (emailId: string) => {
        const { sessionToken } = get()
        if (!sessionToken) return

        set({ isLoading: true, error: null })

        try {
          const response = await axios.delete(`${API_BASE}/user/profile/email/${emailId}`, {
            headers: getAuthHeaders()
          })
          set({ user: response.data, isLoading: false })
          identifyUser((response.data as User).id, selectedEmails(response.data as User))
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to remove email',
            isLoading: false
          })
          throw error
        }
      },

      updateEmailSelection: async (emailIds: string[]) => {
        const { sessionToken } = get()
        if (!sessionToken) return

        set({ isLoading: true, error: null })

        try {
          await axios.put(`${API_BASE}/user/profile/emails/selection`, { emailIds }, {
            headers: getAuthHeaders()
          })
          // Refresh profile to get updated email flags
          await get().refreshProfile()
          const user = get().user
          if (user) identifyUser(user.id, selectedEmails(user))
          set({ isLoading: false })
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to update email selection',
            isLoading: false
          })
        }
      },

      updateAvatarEmail: async (emailId: string | null) => {
        const { sessionToken } = get()
        if (!sessionToken) return

        try {
          const response = await axios.put(`${API_BASE}/user/profile/avatar`, { emailId }, {
            headers: getAuthHeaders()
          })
          set({ user: response.data })
        } catch {
          // Silent fail
        }
      },

      uploadAvatar: async (file: File) => {
        const { sessionToken } = get()
        if (!sessionToken) return

        set({ isLoading: true, error: null })

        try {
          const formData = new FormData()
          formData.append('file', file)
          const response = await axios.put(`${API_BASE}/user/profile/avatar-upload`, formData, {
            headers: { ...getAuthHeaders() },
          })
          set({ user: response.data, isLoading: false })
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to upload avatar',
            isLoading: false,
          })
          throw error
        }
      },

      removeUploadedAvatar: async () => {
        const { sessionToken } = get()
        if (!sessionToken) return

        try {
          const response = await axios.delete(`${API_BASE}/user/profile/avatar-upload`, {
            headers: getAuthHeaders(),
          })
          set({ user: response.data })
        } catch (error: any) {
          set({ error: error.response?.data?.message || 'Failed to remove avatar' })
        }
      },

      updateCalendarEmailSelection: async (emailIds: string[]) => {
        const { sessionToken } = get()
        if (!sessionToken) return
        try {
          await axios.put(`${API_BASE}/user/profile/emails/calendar-selection`, { emailIds }, {
            headers: getAuthHeaders()
          })
          await get().refreshProfile()
        } catch (error: any) {
          set({ error: error.response?.data?.message || 'Failed to update calendar email selection' })
        }
      },

      getCalendarUrls: async () => {
        const { sessionToken } = get()
        if (!sessionToken) return null
        try {
          const response = await axios.get(`${API_BASE}/calendar/me/urls`, {
            headers: getAuthHeaders()
          })
          return response.data
        } catch {
          return null
        }
      },

      deleteAccount: async () => {
        const { sessionToken } = get()
        if (!sessionToken) return

        set({ isLoading: true, error: null })

        try {
          await axios.delete(`${API_BASE}/user/profile?mode=delete`, {
            headers: getAuthHeaders()
          })
          clearPolling()
          set({
            user: null,
            sessionToken: null,
            guestId: null,
            guestReady: false,
            isLoading: false,
            error: null
          })
          localStorage.removeItem('guestId')
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to delete account',
            isLoading: false
          })
        }
      },

      anonymizeAccount: async () => {
        const { sessionToken } = get()
        if (!sessionToken) return

        set({ isLoading: true, error: null })

        try {
          await axios.delete(`${API_BASE}/user/profile?mode=anonymize`, {
            headers: getAuthHeaders()
          })
          clearPolling()
          set({
            user: null,
            sessionToken: null,
            guestId: null,
            guestReady: false,
            isLoading: false,
            error: null
          })
          localStorage.removeItem('guestId')
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to anonymize account',
            isLoading: false
          })
        }
      },

      deleteGuestData: async (mode: 'delete' | 'anonymize') => {
        const { guestId } = get()
        if (!guestId) return

        set({ isLoading: true, error: null })

        try {
          await axios.delete(`${API_BASE}/user/guest/${guestId}?mode=${mode}`)
          clearPolling()
          localStorage.removeItem('guestId')
          const newGuestId = uuidv7()
          localStorage.setItem('guestId', newGuestId)
          set({
            user: null,
            sessionToken: null,
            guestId: newGuestId,
            guestReady: true,
            isLoading: false,
            error: null
          })
          useUiStore.getState().setPickCount(0)
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to delete guest data',
            isLoading: false
          })
        }
      },

      recoverAccount: async (email: string) => {
        set({ isLoading: true, error: null })

        try {
          await axios.post(`${API_BASE}/auth/recover`, { email })
          set({ isLoading: false })
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to send recovery emails',
            isLoading: false
          })
          throw error
        }
      },

      refreshProfile: async () => {
        const { sessionToken } = get()
        if (!sessionToken) return

        try {
          const response = await axios.get(`${API_BASE}/user/profile`, {
            headers: getAuthHeaders()
          })
          set({ user: response.data })
        } catch {
          // Silent fail — profile refresh is best-effort
        }
      },

      refreshTokenIfNeeded: async () => {
        const { sessionToken } = get()
        if (!sessionToken) return

        try {
          // Decode JWT payload (base64url middle segment) to check expiry
          const payload = JSON.parse(atob(sessionToken.split('.')[1]))
          const expiresAt = payload.exp * 1000 // Convert to ms
          const thirtyDays = 30 * 24 * 60 * 60 * 1000

          if (expiresAt - Date.now() < thirtyDays) {
            const response = await axios.post(`${API_BASE}/auth/refresh`, {}, {
              headers: getAuthHeaders()
            })
            set({ sessionToken: response.data.token })
          }
        } catch {
          // Silent fail — token refresh is best-effort
        }
      },

      clearError: () => set({ error: null })
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        sessionToken: state.sessionToken,
        guestId: state.guestId
      })
    }
  )
)

let broadcastListenerInstalled = false

export function installAuthBroadcastListener(): void {
  if (broadcastListenerInstalled) return
  const channel = getAuthChannel()
  if (!channel) return
  broadcastListenerInstalled = true
  channel.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as Partial<BroadcastSessionMessage> | undefined
    if (data?.type !== 'session' || !data.sessionToken || !data.user || !data.requestId) return
    const state = useAuthStore.getState()
    if (state.sessionToken) return
    // Apply only when this tab was waiting for *this exact* requestId. Tabs
    // that initiated a different sign-in attempt (different requestId) or no
    // attempt at all (null) must wait for their own magic link to be clicked.
    if (state.pendingAuthRequestId !== data.requestId) return
    clearPolling()
    useAuthStore.setState({
      user: data.user,
      sessionToken: data.sessionToken,
      guestId: null,
      isLoading: false,
      error: null,
      pendingAuthRequestId: null,
    })
    localStorage.removeItem('guestId')
    identifyUser(data.user.id, selectedEmails(data.user))
    flashTitle()
  })
}
