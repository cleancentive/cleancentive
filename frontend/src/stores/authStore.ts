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

interface CrossDeviceSignIn {
  requestId: string
  browser: string | null
  location: string | null
}

interface AuthState {
  user: User | null
  sessionToken: string | null
  /**
   * Signed session for an anonymous visitor. Guests used to be identified by a
   * uuid this browser made up and sent as a `guestId` parameter — and since
   * user ids are public, anyone could send somebody else's. A guest now
   * authenticates like everyone else; `guestId` below is only the id inside
   * this token, kept for display and for deciding what the UI shows.
   */
  guestToken: string | null
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
  // Set when this browser opened a magic link that completes a sign-in started
  // somewhere else. Completing it hands a session to whoever is polling, so the
  // person is asked first rather than it happening silently.
  crossDeviceSignIn: CrossDeviceSignIn | null

  // Actions
  initializeGuest: () => Promise<void>
  login: (email: string) => Promise<void>
  verifyMagicLink: (token: string) => Promise<void>
  confirmCrossDeviceSignIn: () => Promise<void>
  dismissCrossDeviceSignIn: () => Promise<void>
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

/**
 * The sign-in request this browser started, kept where the magic-link tab can
 * see it. The link often opens in a *new* tab, which shares localStorage but
 * not the in-memory store, and it is the only way to tell "I asked for this"
 * from "somebody else asked and I am about to hand them my session".
 */
const STARTED_REQUEST_KEY = 'pendingAuthRequestId'

function rememberStartedRequest(requestId: string): void {
  try {
    localStorage.setItem(STARTED_REQUEST_KEY, requestId)
  } catch {
    // Private mode or a full quota — we fall back to asking, which is safe.
  }
}

function takeStartedRequest(): string | null {
  try {
    const value = localStorage.getItem(STARTED_REQUEST_KEY)
    localStorage.removeItem(STARTED_REQUEST_KEY)
    return value
  } catch {
    return null
  }
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

async function completePendingAuth(requestId: string, sessionToken: string): Promise<void> {
  try {
    await axios.post(`${API_BASE}/auth/pending/${requestId}/complete`, {}, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
  } catch {
    // The waiting device keeps polling and can be signed in another way; this
    // browser is signed in regardless.
  }
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
      guestToken: null,
      guestId: null,
      isLoading: false,
      error: null,
      guestReady: false,
      pendingAuthRequestId: null,
      crossDeviceSignIn: null,

      initializeGuest: async () => {
        // If already authenticated, skip guest initialization
        if (get().sessionToken && get().user) {
          const user = get().user!
          identifyUser(user.id, selectedEmails(user))
          set({ guestReady: true })
          return
        }

        if (get().guestToken && get().guestId) {
          set({ guestReady: true })
          return
        }

        // Pick the id here and show the app straight away, as before — the app
        // is usable offline and must not wait on a round trip. The server is
        // asked to confirm it and hand back a signed token; it returns this
        // same id unless the id is already somebody's account, so picks queued
        // in the meantime keep the owner they were queued under.
        const knownGuestId = get().guestId || localStorage.getItem('guestId') || uuidv7()
        localStorage.setItem('guestId', knownGuestId)
        set({ guestId: knownGuestId, guestReady: true })

        try {
          const response = await axios.post(`${API_BASE}/auth/guest`, { guestId: knownGuestId })
          const { token, userId } = response.data as { token: string; userId: string }
          localStorage.setItem('guestId', userId)
          set({ guestToken: token, guestId: userId })
        } catch {
          // Offline, or the API is down. Picks keep queueing locally against
          // the id above and sync once a token can be fetched.
        }
      },

      login: async (email: string) => {
        set({ isLoading: true, error: null })
        clearPolling()

        try {
          if (!get().guestToken) {
            await get().initializeGuest()
          }
          const { guestId } = get()
          const response = await axios.post(`${API_BASE}/auth/magic-link`, { email, guestId })
          set({ isLoading: false })

          const requestId = response.data.requestId as string | undefined
          if (requestId) {
            rememberStartedRequest(requestId)
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
        // Read before clearing: this is what says whether the waiting device is
        // this one.
        const startedHere = takeStartedRequest()
        set({ isLoading: true, error: null, pendingAuthRequestId: null, crossDeviceSignIn: null })

        try {
          const response = await axios.get(`${API_BASE}/auth/verify?token=${token}`)
          const sessionToken = response.headers['x-session-token']
          const completedRequestId = response.data?.requestId as string | undefined
          const pendingSignIn = response.data?.pendingSignIn as CrossDeviceSignIn | null | undefined

          const profileResponse = await axios.get(`${API_BASE}/user/profile`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          })

          set({
            user: profileResponse.data,
            sessionToken,
            guestToken: null,
            guestId: null,
            isLoading: false
          })

          // A sign-in is still waiting on a device somewhere. If it is this
          // browser, finish it silently — that is the ordinary case, where
          // someone typed their address here and opened the link here. If it is
          // not, ask: completing it hands a session to whoever started it, and
          // requesting a link for an address you do not own and polling for the
          // result is exactly how an account gets taken over.
          if (pendingSignIn) {
            if (startedHere === pendingSignIn.requestId) {
              await completePendingAuth(pendingSignIn.requestId, sessionToken)
            } else {
              set({ crossDeviceSignIn: pendingSignIn })
            }
          }

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

      confirmCrossDeviceSignIn: async () => {
        const { crossDeviceSignIn, sessionToken } = get()
        if (!crossDeviceSignIn || !sessionToken) return
        set({ crossDeviceSignIn: null })
        await completePendingAuth(crossDeviceSignIn.requestId, sessionToken)
        trackEvent('cross-device-sign-in-confirmed')
      },

      dismissCrossDeviceSignIn: async () => {
        const { crossDeviceSignIn, sessionToken } = get()
        if (!crossDeviceSignIn) return
        set({ crossDeviceSignIn: null })
        if (!sessionToken) return
        try {
          // Drop the request so the other device stops polling and says so,
          // rather than spinning until the link expires.
          await axios.delete(`${API_BASE}/auth/pending/${crossDeviceSignIn.requestId}`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          })
        } catch {
          // It expires on its own anyway.
        }
        trackEvent('cross-device-sign-in-declined')
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
          guestToken: null,
          guestId: null,
          guestReady: false,
          error: null,
          pendingAuthRequestId: null,
          crossDeviceSignIn: null,
        })
        localStorage.removeItem('guestId')
        localStorage.removeItem(STARTED_REQUEST_KEY)
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
            guestToken: null,
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
            guestToken: null,
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
        const { guestToken } = get()
        if (!guestToken) return

        set({ isLoading: true, error: null })

        try {
          // The guest's own token, not an id in the path: DELETE
          // /user/guest/:guestId took whatever id it was handed and would
          // happily delete a registered account.
          await axios.delete(`${API_BASE}/user/profile?mode=${mode}`, {
            headers: { Authorization: `Bearer ${guestToken}` },
          })
          clearPolling()
          localStorage.removeItem('guestId')
          set({
            user: null,
            sessionToken: null,
            guestToken: null,
            guestId: null,
            guestReady: false,
            isLoading: false,
            error: null
          })
          await get().initializeGuest()
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
        guestToken: state.guestToken,
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
      guestToken: null,
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
