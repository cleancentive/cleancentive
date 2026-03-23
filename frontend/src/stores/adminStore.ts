import { create } from 'zustand'
import axios from 'axios'
import { useAuthStore } from './authStore'

interface UserEmail {
  id: string
  email: string
  is_selected_for_login: boolean
}

interface AdminUser {
  id: string
  nickname: string
  full_name?: string
  avatar_email_id?: string | null
  last_login?: string
  created_at: string
  updated_at: string
  emails: UserEmail[]
  is_admin: boolean
}

interface StorageInsights {
  timestamp: string
  totalBytes: number
  totalOriginalBytes: number
  totalThumbnailBytes: number
  spotCount: number
  growthRate: Array<{ week: string; bytes: number }>
}

interface PurgeStatus {
  timestamp: string
  enabled: boolean
  retentionDays: number | null
  lastRunAt: string | null
  totalFreedBytes: number
  lastFreedBytes: number
  lastSpotsPurged: number
  nextRunAt: string | null
  estimatedPurgeBytes: number
  estimatedPurgeCount: number
}

interface OpsOverview {
  timestamp: string
  health: {
    status: 'ok' | 'degraded' | 'down'
  }
  queue: {
    name: string
    counts: {
      waiting: number
      active: number
      delayed: number
      failed: number
      paused: number
    }
  }
  spots: {
    counts: {
      queued: number
      processing: number
      completed: number
      failed: number
    }
    oldestQueuedAgeSeconds: number | null
    oldestProcessingAgeSeconds: number | null
  }
  worker: {
    healthy: boolean
    lastHeartbeatAt: string | null
    lastJobStartedAt: string | null
    lastJobCompletedAt: string | null
    lastJobFailedAt: string | null
  }
}

interface FeedbackItem {
  id: string
  category: 'bug' | 'suggestion' | 'question'
  status: 'new' | 'acknowledged' | 'in_progress' | 'resolved'
  description: string
  contact_email: string | null
  user_id: string | null
  guest_id: string | null
  error_context: Record<string, unknown> | null
  submitter_nickname?: string | null
  created_at: string
  responses: Array<{
    id: string
    message: string
    is_from_steward: boolean
    created_at: string
    created_by?: string | null
    author_nickname?: string | null
  }>
}

interface ArtifactVersion {
  version: string
  buildTime: number
}

interface VersionInfo {
  backend: ArtifactVersion
  worker: ArtifactVersion | null
}

interface AdminState {
  isAdmin: boolean
  users: AdminUser[]
  total: number
  currentPage: number
  sort: 'created_at' | 'last_login'
  order: 'ASC' | 'DESC'
  search: string
  isLoading: boolean
  isLoadingOps: boolean
  isLoadingStorage: boolean
  isLoadingPurge: boolean
  isRetryingFailedSpots: boolean
  hasMore: boolean
  error: string | null
  opsOverview: OpsOverview | null
  storageInsights: StorageInsights | null
  purgeStatus: PurgeStatus | null
  retryFailedSpotsResult: string | null
  feedbackItems: FeedbackItem[]
  feedbackTotal: number
  feedbackStatusFilter: string
  isLoadingFeedback: boolean
  activeFeedbackItem: FeedbackItem | null
  versionInfo: VersionInfo | null

  checkAdminStatus: () => Promise<void>
  fetchVersionInfo: () => Promise<void>
  fetchUsers: (loadMore?: boolean) => Promise<void>
  fetchOpsOverview: () => Promise<void>
  fetchStorageInsights: () => Promise<void>
  fetchPurgeStatus: () => Promise<void>
  retryFailedSpots: (limit: number) => Promise<void>
  setSort: (sort: 'created_at' | 'last_login') => void
  setOrder: (order: 'ASC' | 'DESC') => void
  setSearch: (search: string) => void
  promoteUser: (userId: string) => Promise<void>
  demoteUser: (userId: string) => Promise<void>
  fetchFeedback: (statusFilter?: string) => Promise<void>
  fetchFeedbackDetail: (id: string) => Promise<void>
  updateFeedbackStatus: (id: string, status: string) => Promise<void>
  addAdminResponse: (id: string, message: string) => Promise<void>
  setFeedbackStatusFilter: (status: string) => void
  clearError: () => void
  reset: () => void
}

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const PAGE_SIZE = 10

function getHeaders() {
  const sessionToken = useAuthStore.getState().sessionToken
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}
}

export const useAdminStore = create<AdminState>((set, get) => ({
  isAdmin: false,
  users: [],
  total: 0,
  currentPage: 1,
  sort: 'created_at',
  order: 'DESC',
  search: '',
  isLoading: false,
  isLoadingOps: false,
  isLoadingStorage: false,
  isLoadingPurge: false,
  isRetryingFailedSpots: false,
  hasMore: false,
  error: null,
  opsOverview: null,
  storageInsights: null,
  purgeStatus: null,
  retryFailedSpotsResult: null,
  feedbackItems: [],
  feedbackTotal: 0,
  feedbackStatusFilter: '',
  isLoadingFeedback: false,
  activeFeedbackItem: null,
  versionInfo: null,

  fetchVersionInfo: async () => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    try {
      const response = await axios.get(`${API_BASE}/admin/ops/version`, { headers })
      set({ versionInfo: response.data })
    } catch {
      // version info is non-critical, silently ignore
    }
  },

  checkAdminStatus: async () => {
    const sessionToken = useAuthStore.getState().sessionToken
    if (!sessionToken) {
      set({ isAdmin: false })
      return
    }

    try {
      const response = await axios.get(`${API_BASE}/admin/check`, {
        headers: { Authorization: `Bearer ${sessionToken}` }
      })
      set({ isAdmin: response.data.isAdmin })
    } catch {
      set({ isAdmin: false })
    }
  },

  fetchUsers: async (loadMore = false) => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    const { sort, order, search, currentPage, users } = get()
    const page = loadMore ? currentPage + 1 : 1

    set({ isLoading: true, error: null })

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: PAGE_SIZE.toString(),
        sort,
        order,
      })
      if (search) params.append('search', search)

      const response = await axios.get(`${API_BASE}/admin/users?${params}`, { headers })

      const newUsers = loadMore ? [...users, ...response.data.users] : response.data.users
      set({
        users: newUsers,
        total: response.data.total,
        currentPage: page,
        hasMore: newUsers.length < response.data.total,
        isLoading: false,
      })
    } catch (error: any) {
      set({
        error: error.response?.data?.message || 'Failed to fetch users',
        isLoading: false,
      })
    }
  },

  fetchOpsOverview: async () => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    set({ isLoadingOps: true })

    try {
      const response = await axios.get(`${API_BASE}/admin/ops/overview`, { headers })
      set({ opsOverview: response.data, isLoadingOps: false })
    } catch (error: any) {
      set({
        error: error.response?.data?.message || 'Failed to fetch operations overview',
        isLoadingOps: false,
      })
    }
  },

  fetchStorageInsights: async () => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    set({ isLoadingStorage: true })

    try {
      const response = await axios.get(`${API_BASE}/admin/ops/storage`, { headers })
      set({ storageInsights: response.data, isLoadingStorage: false })
    } catch (error: any) {
      set({
        error: error.response?.data?.message || 'Failed to fetch storage insights',
        isLoadingStorage: false,
      })
    }
  },

  fetchPurgeStatus: async () => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    set({ isLoadingPurge: true })

    try {
      const response = await axios.get(`${API_BASE}/admin/ops/purge`, { headers })
      set({ purgeStatus: response.data, isLoadingPurge: false })
    } catch (error: any) {
      set({
        error: error.response?.data?.message || 'Failed to fetch purge status',
        isLoadingPurge: false,
      })
    }
  },

  retryFailedSpots: async (limit) => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    set({ isRetryingFailedSpots: true, retryFailedSpotsResult: null, error: null })

    try {
      const response = await axios.post(`${API_BASE}/admin/ops/spots/retry-failed`, { limit }, { headers })
      const data = response.data
      set({
        isRetryingFailedSpots: false,
        retryFailedSpotsResult: `Queued ${data.retried} failed spots, skipped ${data.skipped}.`,
      })
      await get().fetchOpsOverview()
    } catch (error: any) {
      set({
        error: error.response?.data?.message || 'Failed to retry failed spots',
        isRetryingFailedSpots: false,
      })
    }
  },

  setSort: (sort) => {
    set({ sort, currentPage: 1, users: [] })
    get().fetchUsers()
  },

  setOrder: (order) => {
    set({ order, currentPage: 1, users: [] })
    get().fetchUsers()
  },

  setSearch: (search) => {
    set({ search, currentPage: 1, users: [] })
    get().fetchUsers()
  },

  promoteUser: async (userId) => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    try {
      await axios.post(`${API_BASE}/admin/users/${userId}/promote`, {}, { headers })
      // Update user in place
      set(state => ({
        users: state.users.map(u => u.id === userId ? { ...u, is_admin: true } : u),
      }))
    } catch (error: any) {
      set({ error: error.response?.data?.message || 'Failed to promote user' })
    }
  },

  demoteUser: async (userId) => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    try {
      await axios.delete(`${API_BASE}/admin/users/${userId}/demote`, { headers })
      set(state => ({
        users: state.users.map(u => u.id === userId ? { ...u, is_admin: false } : u),
      }))
    } catch (error: any) {
      set({ error: error.response?.data?.message || 'Failed to demote user' })
    }
  },

  fetchFeedback: async (statusFilter) => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    const filter = statusFilter !== undefined ? statusFilter : get().feedbackStatusFilter
    set({ isLoadingFeedback: true })

    try {
      const params = new URLSearchParams()
      if (filter) params.set('status', filter)
      const response = await axios.get(`${API_BASE}/feedback?${params}`, { headers })
      set({ feedbackItems: response.data.items, feedbackTotal: response.data.total, isLoadingFeedback: false, feedbackStatusFilter: filter })
    } catch (error: any) {
      set({ error: error.response?.data?.message || 'Failed to fetch feedback', isLoadingFeedback: false })
    }
  },

  fetchFeedbackDetail: async (id) => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    try {
      const response = await axios.get(`${API_BASE}/feedback/${id}`, { headers })
      set({ activeFeedbackItem: response.data })
    } catch (error: any) {
      set({ error: error.response?.data?.message || 'Failed to fetch feedback detail' })
    }
  },

  updateFeedbackStatus: async (id, status) => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    try {
      await axios.patch(`${API_BASE}/feedback/${id}/status`, { status }, { headers })
      await get().fetchFeedback()
    } catch (error: any) {
      set({ error: error.response?.data?.message || 'Failed to update feedback status' })
    }
  },

  addAdminResponse: async (id, message) => {
    const headers = getHeaders()
    if (!headers.Authorization) return

    try {
      await axios.post(`${API_BASE}/feedback/${id}/responses`, { message }, { headers })
      await get().fetchFeedbackDetail(id)
      await get().fetchFeedback()
    } catch (error: any) {
      set({ error: error.response?.data?.message || 'Failed to send response' })
    }
  },

  setFeedbackStatusFilter: (status) => {
    get().fetchFeedback(status)
  },

  clearError: () => set({ error: null }),

  reset: () => set({
    users: [],
    total: 0,
    currentPage: 1,
    search: '',
    hasMore: false,
    opsOverview: null,
    storageInsights: null,
    purgeStatus: null,
    isLoadingOps: false,
    isLoadingStorage: false,
    isLoadingPurge: false,
    isRetryingFailedSpots: false,
    retryFailedSpotsResult: null,
    versionInfo: null,
    error: null,
  }),
}))
