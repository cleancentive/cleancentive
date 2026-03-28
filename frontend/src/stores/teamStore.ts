import { create } from 'zustand'
import axios from 'axios'
import { useAuthStore } from './authStore'
import { trackEvent } from '../lib/analytics'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

function getHeaders() {
  const sessionToken = useAuthStore.getState().sessionToken
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}
}

interface TeamSummary {
  id: string
  name: string
  description: string
  created_at: string
}

interface TeamMember {
  userId: string
  nickname: string
  role: string
  avatarEmailId: string | null
}

interface TeamDetail {
  team: TeamSummary & { custom_css?: string | null }
  members: TeamMember[]
  userRole: string | null
  isPartner: boolean
  emailPatterns?: Array<{ id: string; email_pattern: string }>
}

interface TeamMessage {
  id: string
  subject: string
  body: string
  audience: 'members' | 'organizers'
  created_at: string
  author_user_id: string
  author?: { nickname: string; avatarEmailId: string | null }
}

interface TeamSearchResult {
  team: TeamSummary
  userRole: string | null
  isPartner: boolean
}

interface TeamState {
  teams: TeamSearchResult[]
  myTeams: TeamSearchResult[]
  currentTeam: TeamDetail | null
  messages: TeamMessage[]
  isLoading: boolean
  isLoadingMessages: boolean
  error: string | null

  searchTeams: (query?: string) => Promise<void>
  fetchMyTeams: () => Promise<void>
  fetchTeam: (id: string) => Promise<void>
  createTeam: (name: string, description: string) => Promise<TeamSummary | null>
  updateTeam: (id: string, data: { name?: string; description?: string }) => Promise<void>
  joinTeam: (id: string) => Promise<boolean>
  leaveTeam: (id: string) => Promise<boolean>
  activateTeam: (id: string) => Promise<void>
  deactivateTeam: () => Promise<void>
  promoteMember: (teamId: string, userId: string) => Promise<void>
  archiveTeam: (id: string) => Promise<void>
  fetchMessages: (id: string) => Promise<void>
  postMessage: (id: string, audience: 'members' | 'organizers', subject: string, body: string) => Promise<void>
  updateEmailPatterns: (teamId: string, patterns: string[]) => Promise<void>
  updateCustomCss: (teamId: string, customCss: string | null) => Promise<void>
  importPartnerUrl: (url: string) => Promise<{ domain: string; favicon_url: string | null; colors: { primary: string | null; accent: string | null } } | null>
  clearError: () => void
}

export const useTeamStore = create<TeamState>()((set, get) => ({
  teams: [],
  myTeams: [],
  currentTeam: null,
  messages: [],
  isLoading: false,
  isLoadingMessages: false,
  error: null,

  searchTeams: async (query?: string) => {
    set({ error: null })
    // Only show loading spinner on initial load (empty list), not during search refinement
    if (get().teams.length === 0) set({ isLoading: true })
    try {
      const params = new URLSearchParams()
      if (query?.trim()) params.set('q', query.trim())
      const response = await axios.get(`${API_BASE}/teams?${params}`, { headers: getHeaders() })
      set({ teams: response.data, isLoading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to load teams', isLoading: false })
    }
  },

  fetchMyTeams: async () => {
    try {
      const params = new URLSearchParams({ member_only: 'true' })
      const response = await axios.get(`${API_BASE}/teams?${params}`, { headers: getHeaders() })
      set({ myTeams: response.data })
    } catch {
      // Silently fail — ContextBar dropdowns will just be empty
    }
  },

  fetchTeam: async (id: string) => {
    set({ isLoading: true, error: null, currentTeam: null, messages: [] })
    try {
      const response = await axios.get(`${API_BASE}/teams/${id}`, { headers: getHeaders() })
      set({ currentTeam: response.data, isLoading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to load team', isLoading: false })
    }
  },

  createTeam: async (name: string, description: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.post(`${API_BASE}/teams`, { name, description }, { headers: getHeaders() })
      set({ isLoading: false })
      return response.data
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to create team', isLoading: false })
      return null
    }
  },

  updateTeam: async (id: string, data: { name?: string; description?: string }) => {
    set({ error: null })
    try {
      await axios.put(`${API_BASE}/teams/${id}`, data, { headers: getHeaders() })
      await get().fetchTeam(id)
      await get().searchTeams()
      await useAuthStore.getState().refreshProfile()
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to update team' })
    }
  },

  joinTeam: async (id: string) => {
    set({ error: null })
    try {
      const response = await axios.post(`${API_BASE}/teams/${id}/join`, {}, { headers: getHeaders() })
      if (response.data.joined) {
        trackEvent('team-joined', { team_id: id })
        await get().fetchTeam(id)
      }
      return response.data.joined
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to join team' })
      return false
    }
  },

  leaveTeam: async (id: string) => {
    set({ error: null })
    try {
      const response = await axios.post(`${API_BASE}/teams/${id}/leave`, {}, { headers: getHeaders() })
      if (response.data.left) {
        await get().fetchTeam(id)
      }
      return response.data.left
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to leave team' })
      return false
    }
  },

  activateTeam: async (id: string) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/teams/${id}/activate`, {}, { headers: getHeaders() })
      await useAuthStore.getState().refreshProfile()
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to activate team' })
    }
  },

  deactivateTeam: async () => {
    set({ error: null })
    try {
      await axios.delete(`${API_BASE}/teams/active`, { headers: getHeaders() })
      await useAuthStore.getState().refreshProfile()
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to deactivate team' })
    }
  },

  promoteMember: async (teamId: string, userId: string) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/teams/${teamId}/members/${userId}/promote`, {}, { headers: getHeaders() })
      await get().fetchTeam(teamId)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to promote member' })
    }
  },

  archiveTeam: async (id: string) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/teams/${id}/archive`, {}, { headers: getHeaders() })
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to archive team' })
    }
  },

  fetchMessages: async (id: string) => {
    set({ isLoadingMessages: true })
    try {
      const response = await axios.get(`${API_BASE}/teams/${id}/messages`, { headers: getHeaders() })
      set({ messages: response.data, isLoadingMessages: false })
    } catch (err: any) {
      set({ isLoadingMessages: false })
    }
  },

  postMessage: async (id: string, audience: 'members' | 'organizers', subject: string, body: string) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/teams/${id}/messages`, { audience, subject, body }, { headers: getHeaders() })
      await get().fetchMessages(id)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to send message' })
    }
  },

  updateEmailPatterns: async (teamId: string, patterns: string[]) => {
    set({ error: null })
    try {
      await axios.put(`${API_BASE}/teams/${teamId}/email-patterns`, { patterns }, { headers: getHeaders() })
      await get().fetchTeam(teamId)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to update email patterns' })
    }
  },

  updateCustomCss: async (teamId: string, customCss: string | null) => {
    set({ error: null })
    try {
      await axios.put(`${API_BASE}/teams/${teamId}/custom-css`, { custom_css: customCss }, { headers: getHeaders() })
      await get().fetchTeam(teamId)
      await useAuthStore.getState().refreshProfile()
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to update custom CSS' })
    }
  },

  importPartnerUrl: async (url: string) => {
    set({ error: null })
    try {
      const response = await axios.post(`${API_BASE}/teams/import-partner-url`, { url }, { headers: getHeaders() })
      return response.data
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to import from URL' })
      return null
    }
  },

  clearError: () => set({ error: null }),
}))
