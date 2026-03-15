import { create } from 'zustand'

export type DatePreset = '7d' | '30d' | '1y' | 'all'

interface InsightsFilterState {
  datePreset: DatePreset
  setDatePreset: (preset: DatePreset) => void
}

export function presetToSince(preset: DatePreset): string | undefined {
  if (preset === 'all') return undefined
  const now = new Date()
  if (preset === '7d') now.setDate(now.getDate() - 7)
  else if (preset === '30d') now.setDate(now.getDate() - 30)
  else if (preset === '1y') now.setFullYear(now.getFullYear() - 1)
  return now.toISOString()
}

export const useInsightsFilterStore = create<InsightsFilterState>((set) => ({
  datePreset: 'all',
  setDatePreset: (preset) => set({ datePreset: preset }),
}))
