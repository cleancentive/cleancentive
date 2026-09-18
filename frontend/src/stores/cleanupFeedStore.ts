import { create } from 'zustand'
import axios from 'axios'
import { API_BASE, getAuthHeaders } from '../lib/apiBase'

export type FeedAdapterKind = string

export interface CleanupFeedSettings {
  language: 'en' | 'de' | 'fr'
  horizon: 'upcoming'
  namePrefix: string
}

export interface CleanupFeedRunSummary {
  listed: number
  fetched: number
  skippedPast: number
  created: number
  adopted: number
  updated: number
  archived: number
  unchanged: number
  errors: Array<{ externalId: string; title: string; url: string; reason: string }>
}

export interface CleanupFeed {
  id: string
  team_id: string
  kind: FeedAdapterKind
  url: string
  settings: CleanupFeedSettings
  enabled: boolean
  last_run_at: string | null
  last_success_at: string | null
  last_error: string | null
  last_summary: CleanupFeedRunSummary | null
}

export interface FeedPreviewEntry {
  action: 'create' | 'adopt' | 'update' | 'archive' | 'unchanged' | 'error'
  name: string
  startAt: string | null
  cleanupId: string | null
  note: string | null
}

export type FeedPreview =
  | { state: 'none' }
  | { state: 'queued' | 'running'; requestedAt: string }
  | { state: 'done'; requestedAt: string; finishedAt: string; plan: { entries: FeedPreviewEntry[] } }
  | { state: 'failed'; requestedAt: string; finishedAt: string; error: string }

interface CleanupFeedState {
  feeds: CleanupFeed[]
  availableKinds: FeedAdapterKind[]
  schedulerEnabled: boolean
  nextRunAt: string | null
  preview: { feedId: string; result: FeedPreview } | null
  isLoading: boolean
  busyFeedId: string | null
  error: string | null

  fetchFeeds: (teamId: string) => Promise<void>
  createFeed: (teamId: string, input: { kind: string; url: string; settings: Partial<CleanupFeedSettings> }) => Promise<boolean>
  updateFeed: (teamId: string, feedId: string, patch: { enabled?: boolean; settings?: Partial<CleanupFeedSettings>; url?: string }) => Promise<void>
  deleteFeed: (teamId: string, feedId: string) => Promise<void>
  refreshFeed: (teamId: string, feedId: string) => Promise<void>
  previewFeed: (teamId: string, feedId: string) => Promise<void>
  clearPreview: () => void
  clearError: () => void
}

function message(err: any, fallback: string): string {
  return err?.response?.data?.message || fallback
}

export const useCleanupFeedStore = create<CleanupFeedState>()((set, get) => ({
  feeds: [],
  availableKinds: [],
  schedulerEnabled: true,
  nextRunAt: null,
  preview: null,
  isLoading: false,
  busyFeedId: null,
  error: null,

  fetchFeeds: async (teamId: string) => {
    set({ isLoading: true })
    try {
      const response = await axios.get(`${API_BASE}/teams/${teamId}/feeds`, { headers: getAuthHeaders() })
      set({
        feeds: response.data.feeds,
        availableKinds: response.data.availableKinds,
        schedulerEnabled: response.data.schedulerEnabled,
        nextRunAt: response.data.nextRunAt,
        isLoading: false,
      })
    } catch (err: any) {
      // Only stewards may list feeds; for anyone else this is simply not there.
      set({ feeds: [], isLoading: false })
    }
  },

  createFeed: async (teamId, input) => {
    set({ error: null })
    try {
      await axios.post(`${API_BASE}/teams/${teamId}/feeds`, input, { headers: getAuthHeaders() })
      await get().fetchFeeds(teamId)
      return true
    } catch (err: any) {
      set({ error: message(err, 'Failed to add the feed') })
      return false
    }
  },

  updateFeed: async (teamId, feedId, patch) => {
    set({ error: null, busyFeedId: feedId })
    try {
      await axios.put(`${API_BASE}/teams/${teamId}/feeds/${feedId}`, patch, { headers: getAuthHeaders() })
      await get().fetchFeeds(teamId)
    } catch (err: any) {
      set({ error: message(err, 'Failed to update the feed') })
    } finally {
      set({ busyFeedId: null })
    }
  },

  deleteFeed: async (teamId, feedId) => {
    set({ error: null, busyFeedId: feedId })
    try {
      await axios.delete(`${API_BASE}/teams/${teamId}/feeds/${feedId}`, { headers: getAuthHeaders() })
      await get().fetchFeeds(teamId)
    } catch (err: any) {
      set({ error: message(err, 'Failed to delete the feed') })
    } finally {
      set({ busyFeedId: null })
    }
  },

  refreshFeed: async (teamId, feedId) => {
    set({ error: null, busyFeedId: feedId })
    try {
      await axios.post(`${API_BASE}/teams/${teamId}/feeds/${feedId}/refresh`, { dryRun: false }, { headers: getAuthHeaders() })
      await get().fetchFeeds(teamId)
    } catch (err: any) {
      set({ error: message(err, 'Failed to start the refresh') })
    } finally {
      set({ busyFeedId: null })
    }
  },

  /**
   * A dry run is queued like a real one, so this asks for it and then polls —
   * reading the source politely takes longer than a request should.
   */
  previewFeed: async (teamId, feedId) => {
    set({ error: null, busyFeedId: feedId, preview: { feedId, result: { state: 'queued', requestedAt: new Date().toISOString() } } })
    try {
      await axios.post(`${API_BASE}/teams/${teamId}/feeds/${feedId}/refresh`, { dryRun: true }, { headers: getAuthHeaders() })
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const response = await axios.get(`${API_BASE}/teams/${teamId}/feeds/${feedId}/preview`, { headers: getAuthHeaders() })
        const result = response.data as FeedPreview
        set({ preview: { feedId, result } })
        if (result.state === 'done' || result.state === 'failed') {
          return
        }
      }
    } catch (err: any) {
      set({ error: message(err, 'Failed to preview the feed'), preview: null })
    } finally {
      set({ busyFeedId: null })
    }
  },

  clearPreview: () => set({ preview: null }),
  clearError: () => set({ error: null }),
}))
