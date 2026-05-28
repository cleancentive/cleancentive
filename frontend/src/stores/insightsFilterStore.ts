import { create } from 'zustand'

export type DatePreset = '7d' | '30d' | '1y' | 'all'
export type PickedUpFilter = 'picked' | 'spotted' | 'all'
export type SubjectFilter = 'litter' | 'plants' | 'all'

export type CleanupFilter =
  | { kind: 'date'; cleanupDateId: string; cleanupId: string; cleanupName: string }
  | { kind: 'cleanup'; cleanupId: string; cleanupName: string }
  | null

interface InsightsFilterState {
  datePreset: DatePreset
  setDatePreset: (preset: DatePreset) => void
  pickedUpFilter: PickedUpFilter
  setPickedUpFilter: (filter: PickedUpFilter) => void
  subjectFilter: SubjectFilter
  setSubjectFilter: (filter: SubjectFilter) => void
  myFilter: boolean
  setMyFilter: (value: boolean) => void
  cleanupFilter: CleanupFilter
  setCleanupFilter: (filter: CleanupFilter) => void
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

export function subjectFilterToParam(filter: SubjectFilter): 'litter' | 'plant' | undefined {
  if (filter === 'litter') return 'litter'
  if (filter === 'plants') return 'plant'
  return undefined
}

const FILTER_DEFAULTS = {
  myFilter: false,
  pickedUpFilter: 'all' as PickedUpFilter,
  subjectFilter: 'all' as SubjectFilter,
  datePreset: 'all' as DatePreset,
  cleanupFilter: null as CleanupFilter,
}

export const useInsightsFilterStore = create<InsightsFilterState>((set) => ({
  ...FILTER_DEFAULTS,
  setDatePreset: (preset) => set({ datePreset: preset }),
  setPickedUpFilter: (filter) => set({ pickedUpFilter: filter }),
  setSubjectFilter: (filter) => set({ subjectFilter: filter }),
  setMyFilter: (value) => set({ myFilter: value }),
  setCleanupFilter: (filter) => set({ cleanupFilter: filter }),
  clearFilters: () => set(FILTER_DEFAULTS),
}))
