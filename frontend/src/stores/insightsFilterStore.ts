import { create } from 'zustand'

export type DatePreset = '7d' | '30d' | '1y' | 'all'
export type PickedUpFilter = 'picked' | 'spotted' | 'all'

interface InsightsFilterState {
  datePreset: DatePreset
  setDatePreset: (preset: DatePreset) => void
  pickedUpFilter: PickedUpFilter
  setPickedUpFilter: (filter: PickedUpFilter) => void
  myFilter: boolean
  setMyFilter: (value: boolean) => void
  clearFilters: () => void
}

export function presetToSince(preset: DatePreset): string | undefined {
  if (preset === 'all') return undefined
  const now = new Date()
  if (preset === '7d') now.setDate(now.getDate() - 7)
  else if (preset === '30d') now.setDate(now.getDate() - 30)
  else if (preset === '1y') now.setFullYear(now.getFullYear() - 1)
  return now.toISOString()
}

export function pickedUpFilterToParam(filter: PickedUpFilter): string | undefined {
  if (filter === 'picked') return 'true'
  if (filter === 'spotted') return 'false'
  return undefined
}

const FILTER_DEFAULTS = {
  myFilter: false,
  pickedUpFilter: 'picked' as PickedUpFilter,
  datePreset: 'all' as DatePreset,
}

export const useInsightsFilterStore = create<InsightsFilterState>((set) => ({
  ...FILTER_DEFAULTS,
  setDatePreset: (preset) => set({ datePreset: preset }),
  setPickedUpFilter: (filter) => set({ pickedUpFilter: filter }),
  setMyFilter: (value) => set({ myFilter: value }),
  clearFilters: () => set(FILTER_DEFAULTS),
}))
