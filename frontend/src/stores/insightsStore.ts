import { create } from 'zustand'
import axios from 'axios'

interface TimeSeriesEntry {
  week: string
  count: number
}

interface WeightTimeSeriesEntry {
  week: string
  total: number
}

interface PublicStats {
  summary: {
    totalCleanups: number
    totalUsers: number
    totalTeams: number
    totalSpots: number
    totalItems: number
    estimatedWeightGrams: number
  }
  timeSeries: {
    spots: TimeSeriesEntry[]
    items: TimeSeriesEntry[]
    cleanups: TimeSeriesEntry[]
    estimatedWeightGrams: WeightTimeSeriesEntry[]
  }
  spotStats: {
    byStatus: { queued: number; processing: number; completed: number; failed: number }
    topCategories: Array<{ category: string; count: number }>
    topMaterials: Array<{ material: string; count: number }>
  }
}

interface InsightsState {
  stats: PublicStats | null
  isLoading: boolean
  error: string | null
  fetchStats: () => Promise<void>
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export const useInsightsStore = create<InsightsState>((set) => ({
  stats: null,
  isLoading: false,
  error: null,

  fetchStats: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.get(`${API_BASE}/insights/stats`)
      set({ stats: response.data, isLoading: false })
    } catch (error: any) {
      set({
        error: error.response?.data?.message || 'Failed to fetch insights',
        isLoading: false,
      })
    }
  },
}))
