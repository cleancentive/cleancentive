import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'

interface User {
  id: string
  nickname: string
  full_name?: string
  emails: Array<{
    email: string
    is_selected_for_login: boolean
  }>
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
        set({ isLoading: true, error: null, guestReady: false })

        try {
          const existingGuestId = get().guestId || localStorage.getItem('guestId')

          if (existingGuestId) {
            try {
              await axios.get(`${API_BASE}/user/${existingGuestId}`)
              localStorage.setItem('guestId', existingGuestId)
              set({ guestId: existingGuestId, isLoading: false, guestReady: true })
              return
            } catch {
              // Stale guest ID — clear and create a new one
              localStorage.removeItem('guestId')
            }
          }

          const response = await axios.post(`${API_BASE}/user/guest`)
          const newGuestId = response.data.id
          localStorage.setItem('guestId', newGuestId)
          set({ guestId: newGuestId, isLoading: false, guestReady: true })
        } catch (error: any) {
          set({
            error: error.response?.data?.message || 'Failed to initialize guest account',
            isLoading: false,
            guestReady: false
          })
        }
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

          // Get user profile
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
