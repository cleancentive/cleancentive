import { create } from 'zustand'
import axios from 'axios'
import type { StatsFilterParams } from './insightsStore'

export type HeatMetric = 'items' | 'mass'

interface MapState {
  spotGeoJson: GeoJSON.FeatureCollection | null
  cleanupGeoJson: GeoJSON.FeatureCollection | null
  isLoading: boolean
  error: string | null
  fetchMapData: (params?: StatsFilterParams) => Promise<void>
  heatMetric: HeatMetric
  setHeatMetric: (m: HeatMetric) => void
}

import { API_BASE } from '../lib/apiBase'

export const useMapStore = create<MapState>((set) => ({
  spotGeoJson: null,
  cleanupGeoJson: null,
  isLoading: false,
  error: null,
  heatMetric: 'items',
  setHeatMetric: (m) => set({ heatMetric: m }),

  fetchMapData: async (params?: StatsFilterParams) => {
    set({ isLoading: true, error: null })
    try {
      const searchParams = new URLSearchParams()
      if (params?.team_id) searchParams.set('team_id', params.team_id)
      if (params?.cleanup_date_id) searchParams.set('cleanup_date_id', params.cleanup_date_id)
      else if (params?.cleanup_id) searchParams.set('cleanup_id', params.cleanup_id)
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
