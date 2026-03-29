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
    topObjects: Array<{ object: string; count: number }>
    topMaterials: Array<{ material: string; count: number }>
    topBrands: Array<{ brand: string; count: number }>
  }
}

export interface StatsFilterParams {
  team_id?: string
  cleanup_date_id?: string
  since?: string
  picked_up?: string
  user_id?: string
}

interface InsightsState {
  stats: PublicStats | null
  isLoading: boolean
  error: string | null
  fetchStats: (params?: StatsFilterParams) => Promise<void>
}

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export const useInsightsStore = create<InsightsState>((set) => ({
  stats: null,
  isLoading: false,
  error: null,

  fetchStats: async (params?: StatsFilterParams) => {
    set({ isLoading: true, error: null })
    try {
      const searchParams = new URLSearchParams()
      if (params?.team_id) searchParams.set('team_id', params.team_id)
      if (params?.cleanup_date_id) searchParams.set('cleanup_date_id', params.cleanup_date_id)
      if (params?.since) searchParams.set('since', params.since)
      if (params?.picked_up) searchParams.set('picked_up', params.picked_up)
      if (params?.user_id) searchParams.set('user_id', params.user_id)
      const qs = searchParams.toString()
      const response = await axios.get(`${API_BASE}/insights/stats${qs ? '?' + qs : ''}`)
      set({ stats: response.data, isLoading: false })
    } catch (error: any) {
      set({
        error: error.response?.data?.message || 'Failed to fetch insights',
        isLoading: false,
      })
    }
  },
}))
