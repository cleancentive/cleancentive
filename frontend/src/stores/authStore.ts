import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'
import { v7 as uuidv7 } from 'uuid'

interface UserEmail {
  id: string
  email: string
  is_selected_for_login: boolean
}

interface User {
  id: string
  nickname: string
  full_name?: string
  emails: UserEmail[]
}

interface AuthState {
  user: User | null
  sessionToken: string | null
  guestId: string | null
  isLoading: boolean
  error: string | null
  guestReady: boolean

  // Actions
  initializeGuest: () => Promise<void>
  login: (email: string) => Promise<void>
  verifyMagicLink: (token: string) => Promise<void>
  logout: () => void
  updateProfile: (data: { nickname?: string; full_name?: string }) => Promise<void>
  addEmail: (email: string) => Promise<{ status: string; ownerNickname?: string }>
  confirmMerge: (email: string) => Promise<boolean>
  removeEmail: (emailId: string) => Promise<void>
  updateEmailSelection: (emailIds: string[]) => Promise<void>
  deleteAccount: () => Promise<void>
  anonymizeAccount: () => Promise<void>
  recoverAccount: (email: string) => Promise<void>
  refreshProfile: () => Promise<void>
  refreshTokenIfNeeded: () => Promise<void>
  clearError: () => void
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionToken: null,
      guestId: null,
      isLoading: false,
      error: null,
      guestReady: false,

      initializeGuest: async () => {
        // If already authenticated, skip guest initialization
        if (get().sessionToken && get().user) {
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

        try {
          await axios.post(`${API_BASE}/auth/magic-link`, { email, guestId: get().guestId })
          set({ isLoading: false })
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to send magic link',
            isLoading: false
          })
        }
      },

      verifyMagicLink: async (token: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await axios.get(`${API_BASE}/auth/verify?token=${token}`)
          const sessionToken = response.headers['x-session-token']

          const profileResponse = await axios.get(`${API_BASE}/user/profile`, {
            headers: { Authorization: `Bearer ${sessionToken}` }
          })

          set({
            user: profileResponse.data,
            sessionToken,
            guestId: null,
            isLoading: false
          })

          localStorage.removeItem('guestId')
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Invalid or expired magic link',
            isLoading: false
          })
        }
      },

      logout: () => {
        set({
          user: null,
          sessionToken: null,
          guestId: null,
          guestReady: false,
          error: null
        })
        localStorage.removeItem('guestId')
      },

      updateProfile: async (data: { nickname?: string; full_name?: string }) => {
        const { sessionToken } = get()
        if (!sessionToken) return

        set({ isLoading: true, error: null })

        try {
          const response = await axios.put(`${API_BASE}/user/profile`, data, {
            headers: { Authorization: `Bearer ${sessionToken}` }
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
            headers: { Authorization: `Bearer ${sessionToken}` }
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
            headers: { Authorization: `Bearer ${sessionToken}` }
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
            headers: { Authorization: `Bearer ${sessionToken}` }
          })
          set({ user: response.data, isLoading: false })
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
            headers: { Authorization: `Bearer ${sessionToken}` }
          })
          // Refresh profile to get updated email flags
          await get().refreshProfile()
          set({ isLoading: false })
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to update email selection',
            isLoading: false
          })
        }
      },

      deleteAccount: async () => {
        const { sessionToken } = get()
        if (!sessionToken) return

        set({ isLoading: true, error: null })

        try {
          await axios.delete(`${API_BASE}/user/profile?mode=delete`, {
            headers: { Authorization: `Bearer ${sessionToken}` }
          })
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
            headers: { Authorization: `Bearer ${sessionToken}` }
          })
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
            headers: { Authorization: `Bearer ${sessionToken}` }
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
              headers: { Authorization: `Bearer ${sessionToken}` }
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
