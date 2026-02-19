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
  last_login?: string
  created_at: string
  updated_at: string
  emails: UserEmail[]
  is_admin: boolean
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
  hasMore: boolean
  error: string | null

  checkAdminStatus: () => Promise<void>
  fetchUsers: (loadMore?: boolean) => Promise<void>
  setSort: (sort: 'created_at' | 'last_login') => void
  setOrder: (order: 'ASC' | 'DESC') => void
  setSearch: (search: string) => void
  promoteUser: (userId: string) => Promise<void>
  demoteUser: (userId: string) => Promise<void>
  clearError: () => void
  reset: () => void
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
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
  hasMore: false,
  error: null,

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

  clearError: () => set({ error: null }),

  reset: () => set({
    users: [],
    total: 0,
    currentPage: 1,
    search: '',
    hasMore: false,
    error: null,
  }),
}))
