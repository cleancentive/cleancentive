import { create } from 'zustand'
import axios from 'axios'
import { useAuthStore } from './authStore'
import { trackEvent } from '../lib/analytics'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

function getHeaders() {
  const sessionToken = useAuthStore.getState().sessionToken
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}
}

interface CleanupSummary {
  id: string
  name: string
  description: string
  created_at: string
}

interface CleanupDate {
  id: string
  start_at: string
  end_at: string
  latitude: number
  longitude: number
  location_name: string | null
  recurrence_id: string | null
}

interface CleanupParticipant {
  userId: string
  nickname: string
  role: string
  avatarEmailId: string | null
}

interface CleanupSearchResult {
  cleanup: CleanupSummary
  nearestDate: CleanupDate | null
  userRole: string | null
}

interface CleanupDetail {
  cleanup: CleanupSummary
  dates: CleanupDate[]
  participants: CleanupParticipant[]
  userRole: string | null
}

interface CleanupMessage {
  id: string
  subject: string
  body: string
  audience: 'members' | 'organizers'
  created_at: string
  author_user_id: string
  author?: { nickname: string; avatarEmailId: string | null }
}

interface CleanupState {
  cleanups: CleanupSearchResult[]
  myCleanups: CleanupSearchResult[]
  currentCleanup: CleanupDetail | null
  messages: CleanupMessage[]
  statusFilter: 'past' | 'ongoing' | 'future' | null
  isLoading: boolean
  isLoadingMessages: boolean
  error: string | null

  searchCleanups: (query?: string) => Promise<void>
  fetchMyCleanups: () => Promise<void>
  fetchCleanup: (id: string) => Promise<void>
  createCleanup: (name: string, description: string, date: {
    startAt: string
    endAt: string
    latitude: number
    longitude: number
    locationName?: string
  }) => Promise<CleanupSummary | null>
  updateCleanup: (id: string, data: { name?: string; description?: string }) => Promise<void>
  joinCleanup: (id: string) => Promise<boolean>
  leaveCleanup: (id: string) => Promise<boolean>
  addDate: (id: string, date: {
    startAt: string
    endAt: string
    latitude: number
    longitude: number
    locationName?: string
  }) => Promise<void>
  updateDate: (cleanupDateId: string, date: {
    startAt: string
    endAt: string
    latitude: number
    longitude: number
    locationName?: string
  }) => Promise<void>
  deleteDate: (cleanupId: string, cleanupDateId: string) => Promise<void>
  addDatesBulk: (cleanupId: string, recurrenceId: string, dates: Array<{
    startAt: string; endAt: string; latitude: number; longitude: number; locationName?: string
  }>) => Promise<void>
  deleteDatesBulk: (cleanupId: string, dateIds: string[]) => Promise<void>
  activateDate: (cleanupDateId: string) => Promise<void>
  deactivateDate: () => Promise<void>
  promoteParticipant: (cleanupId: string, userId: string) => Promise<void>
  archiveCleanup: (id: string) => Promise<void>
  fetchMessages: (id: string) => Promise<void>
  postMessage: (id: string, audience: 'members' | 'organizers', subject: string, body: string) => Promise<void>
  setStatusFilter: (status: 'past' | 'ongoing' | 'future' | null) => void
  clearError: () => void
}

export const useCleanupStore = create<CleanupState>()((set, get) => ({
  cleanups: [],
  myCleanups: [],
  currentCleanup: null,
  messages: [],
  statusFilter: null,
  isLoading: false,
  isLoadingMessages: false,
  error: null,

  searchCleanups: async (query?: string) => {
    set({ error: null })
    if (get().cleanups.length === 0) set({ isLoading: true })
    try {
      const params = new URLSearchParams()
      if (query?.trim()) params.set('q', query.trim())
      const status = get().statusFilter
      if (status) params.set('status', status)
      const response = await axios.get(`${API_BASE}/cleanups/search?${params}`, { headers: getHeaders() })
      set({ cleanups: response.data, isLoading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to load cleanups', isLoading: false })
    }
  },

  fetchMyCleanups: async () => {
    try {
      const params = new URLSearchParams({ member_only: 'true' })
      const response = await axios.get(`${API_BASE}/cleanups/search?${params}`, { headers: getHeaders() })
      set({ myCleanups: response.data })
    } catch {
      // Silently fail — ContextBar dropdowns will just be empty
    }
  },

  fetchCleanup: async (id: string) => {
    set({ isLoading: true, error: null, currentCleanup: null, messages: [] })
    try {
      const response = await axios.get(`${API_BASE}/cleanups/${id}`, { headers: getHeaders() })
      set({ currentCleanup: response.data, isLoading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to load cleanup', isLoading: false })
    }
  },

  createCleanup: async (name, description, date) => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.post(`${API_BASE}/cleanups`, {
        name,
        description,
        date: {
          startAt: date.startAt,
          endAt: date.endAt,
          latitude: date.latitude,
          longitude: date.longitude,
          locationName: date.locationName,
        },
      }, { headers: getHeaders() })
      trackEvent('cleanup-created')
      set({ isLoading: false })
      return response.data.cleanup
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to create cleanup', isLoading: false })
      return null
    }
  },

  updateCleanup: async (id, data) => {
    set({ error: null })
    try {
      await axios.put(`${API_BASE}/cleanups/${id}`, data, { headers: getHeaders() })
      await get().fetchCleanup(id)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to update cleanup' })
    }
  },

  joinCleanup: async (id: string) => {
    set({ error: null })
    try {
      const response = await axios.post(`${API_BASE}/cleanups/${id}/join`, {}, { headers: getHeaders() })
      if (response.data.joined) {
        trackEvent('cleanup-joined', { cleanup_id: id })
        await get().fetchCleanup(id)
        await get().fetchMyCleanups()
      }
      return response.data.joined
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to join cleanup' })
      return false
    }
  },

  leaveCleanup: async (id: string) => {
    set({ error: null })
    try {
      const response = await axios.post(`${API_BASE}/cleanups/${id}/leave`, {}, { headers: getHeaders() })
      if (response.data.left) {
        await get().fetchCleanup(id)
        await get().fetchMyCleanups()
      }
      return response.data.left
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to leave cleanup' })
      return false
    }
  },

  addDate: async (id, date) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/cleanups/${id}/dates`, {
        startAt: date.startAt,
        endAt: date.endAt,
        latitude: date.latitude,
        longitude: date.longitude,
        locationName: date.locationName,
      }, { headers: getHeaders() })
      await get().fetchCleanup(id)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to add date' })
    }
  },

  updateDate: async (cleanupDateId: string, date) => {
    set({ error: null })
    try {
      await axios.put(`${API_BASE}/cleanups/dates/${cleanupDateId}`, {
        startAt: date.startAt,
        endAt: date.endAt,
        latitude: date.latitude,
        longitude: date.longitude,
        locationName: date.locationName,
      }, { headers: getHeaders() })
      // Refresh the cleanup to get updated dates
      const current = get().currentCleanup
      if (current) await get().fetchCleanup(current.cleanup.id)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to update date' })
    }
  },

  deleteDate: async (cleanupId: string, cleanupDateId: string) => {
    set({ error: null })
    try {
      await axios.delete(`${API_BASE}/cleanups/dates/${cleanupDateId}`, { headers: getHeaders() })
      await get().fetchCleanup(cleanupId)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to delete date' })
    }
  },

  addDatesBulk: async (cleanupId, recurrenceId, dates) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/cleanups/${cleanupId}/dates/bulk`, { recurrenceId, dates }, { headers: getHeaders() })
      await get().fetchCleanup(cleanupId)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to create dates' })
    }
  },

  deleteDatesBulk: async (cleanupId, dateIds) => {
    set({ error: null })
    try {
      await axios.delete(`${API_BASE}/cleanups/${cleanupId}/dates/bulk`, { headers: getHeaders(), data: { dateIds } })
      await get().fetchCleanup(cleanupId)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to delete dates' })
    }
  },

  activateDate: async (cleanupDateId: string) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/cleanups/dates/${cleanupDateId}/activate`, {}, { headers: getHeaders() })
      await useAuthStore.getState().refreshProfile()
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to activate date' })
    }
  },

  deactivateDate: async () => {
    set({ error: null })
    try {
      await axios.delete(`${API_BASE}/cleanups/dates/active`, { headers: getHeaders() })
      await useAuthStore.getState().refreshProfile()
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to deactivate date' })
    }
  },

  promoteParticipant: async (cleanupId: string, userId: string) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/cleanups/${cleanupId}/participants/${userId}/promote`, {}, { headers: getHeaders() })
      await get().fetchCleanup(cleanupId)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to promote participant' })
    }
  },

  archiveCleanup: async (id: string) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/cleanups/${id}/archive`, {}, { headers: getHeaders() })
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to archive cleanup' })
    }
  },

  fetchMessages: async (id: string) => {
    set({ isLoadingMessages: true })
    try {
      const response = await axios.get(`${API_BASE}/cleanups/${id}/messages`, { headers: getHeaders() })
      set({ messages: response.data, isLoadingMessages: false })
    } catch {
      set({ isLoadingMessages: false })
    }
  },

  postMessage: async (id: string, audience: 'members' | 'organizers', subject: string, body: string) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/cleanups/${id}/messages`, { audience, subject, body }, { headers: getHeaders() })
      await get().fetchMessages(id)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to send message' })
    }
  },

  setStatusFilter: (status) => {
    set({ statusFilter: status })
  },

  clearError: () => set({ error: null }),
}))

export interface ParticipatedCleanupDate {
  cleanupDateId: string
  cleanupId: string
  cleanupName: string
  startAt: string
  endAt: string
  latitude: number
  longitude: number
  locationName: string | null
}

export async function fetchParticipatedDates(from: string, to: string): Promise<ParticipatedCleanupDate[]> {
  const sessionToken = useAuthStore.getState().sessionToken
  if (!sessionToken) return []

  const params = new URLSearchParams({ from, to })
  const response = await axios.get(`${API_BASE}/cleanups/my-dates?${params}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
  return response.data
}
