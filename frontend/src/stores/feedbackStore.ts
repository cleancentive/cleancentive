import { create } from 'zustand'
import axios from 'axios'
import { useAuthStore } from './authStore'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

function getHeaders() {
  const token = useAuthStore.getState().sessionToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

interface FeedbackSummary {
  id: string
  category: 'bug' | 'suggestion' | 'question'
  status: 'new' | 'acknowledged' | 'in_progress' | 'resolved'
  description: string
  contact_email: string | null
  created_at: string
  responses: FeedbackResponseItem[]
}

interface FeedbackResponseItem {
  id: string
  message: string
  is_from_steward: boolean
  created_at: string
  author_nickname?: string | null
}

interface FeedbackDetail extends FeedbackSummary {
  error_context: { url?: string; message?: string; userAgent?: string; stack?: string } | null
  submitter_nickname?: string | null
}

interface ErrorContext {
  url?: string
  message?: string
  userAgent?: string
  stack?: string
}

interface FeedbackState {
  isModalOpen: boolean
  isSubmitting: boolean
  isSubmitted: boolean
  error: string | null
  prefilled: { category?: string; description?: string; errorContext?: ErrorContext } | null

  myFeedback: FeedbackSummary[]
  activeFeedback: FeedbackDetail | null
  isLoadingMine: boolean
  isLoadingDetail: boolean

  openFeedbackModal: (prefill?: { category?: string; description?: string; errorContext?: ErrorContext }) => void
  closeFeedbackModal: () => void
  submitFeedback: (data: {
    category: string
    description: string
    contactEmail?: string
    errorContext?: ErrorContext
  }) => Promise<void>
  fetchMyFeedback: () => Promise<void>
  fetchFeedbackDetail: (id: string) => Promise<void>
  addResponse: (id: string, message: string) => Promise<void>
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  isModalOpen: false,
  isSubmitting: false,
  isSubmitted: false,
  error: null,
  prefilled: null,

  myFeedback: [],
  activeFeedback: null,
  isLoadingMine: false,
  isLoadingDetail: false,

  openFeedbackModal: (prefill) => {
    set({ isModalOpen: true, isSubmitted: false, error: null, prefilled: prefill || null })
  },

  closeFeedbackModal: () => {
    set({ isModalOpen: false, prefilled: null, isSubmitted: false, error: null })
  },

  submitFeedback: async (data) => {
    set({ isSubmitting: true, error: null })
    try {
      const guestId = useAuthStore.getState().guestId
      await axios.post(`${API_BASE}/feedback`, {
        ...data,
        guestId,
      }, { headers: getHeaders() })
      set({ isSubmitting: false, isSubmitted: true })
    } catch (err: any) {
      set({ isSubmitting: false, error: err.response?.data?.message || 'Failed to submit feedback' })
    }
  },

  fetchMyFeedback: async () => {
    set({ isLoadingMine: true })
    try {
      const guestId = useAuthStore.getState().guestId
      const params = new URLSearchParams()
      if (guestId) params.set('guestId', guestId)
      const response = await axios.get(`${API_BASE}/feedback/mine?${params}`, { headers: getHeaders() })
      set({ myFeedback: response.data, isLoadingMine: false })
    } catch {
      set({ isLoadingMine: false })
    }
  },

  fetchFeedbackDetail: async (id) => {
    set({ isLoadingDetail: true, activeFeedback: null })
    try {
      const guestId = useAuthStore.getState().guestId
      const params = new URLSearchParams()
      if (guestId) params.set('guestId', guestId)
      const response = await axios.get(`${API_BASE}/feedback/${id}?${params}`, { headers: getHeaders() })
      set({ activeFeedback: response.data, isLoadingDetail: false })
    } catch {
      set({ isLoadingDetail: false })
    }
  },

  addResponse: async (id, message) => {
    try {
      const guestId = useAuthStore.getState().guestId
      await axios.post(`${API_BASE}/feedback/${id}/responses`, { message, guestId }, { headers: getHeaders() })
      await get().fetchFeedbackDetail(id)
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to send response' })
    }
  },
}))
