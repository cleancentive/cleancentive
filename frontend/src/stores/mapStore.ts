import { create } from 'zustand'
import axios from 'axios'
import type { StatsFilterParams } from './insightsStore'

interface MapState {
  spotGeoJson: GeoJSON.FeatureCollection | null
  cleanupGeoJson: GeoJSON.FeatureCollection | null
  isLoading: boolean
  error: string | null
  fetchMapData: (params?: StatsFilterParams) => Promise<void>
}

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export const useMapStore = create<MapState>((set) => ({
  spotGeoJson: null,
  cleanupGeoJson: null,
  isLoading: false,
  error: null,

  fetchMapData: async (params?: StatsFilterParams) => {
    set({ isLoading: true, error: null })
    try {
      const searchParams = new URLSearchParams()
      if (params?.team_id) searchParams.set('team_id', params.team_id)
      if (params?.cleanup_date_id) searchParams.set('cleanup_date_id', params.cleanup_date_id)
      if (params?.since) searchParams.set('since', params.since)
      if (params?.picked_up) searchParams.set('picked_up', params.picked_up)
      if (params?.user_id) searchParams.set('user_id', params.user_id)
      const qs = searchParams.toString()
      const response = await axios.get(`${API_BASE}/insights/map${qs ? '?' + qs : ''}`)
      set({
        spotGeoJson: response.data.spots,
        cleanupGeoJson: response.data.cleanupLocations,
        isLoading: false,
      })
    } catch (error: any) {
      set({
        error: error.response?.data?.message || 'Failed to fetch map data',
        isLoading: false,
      })
    }
  },
}))
