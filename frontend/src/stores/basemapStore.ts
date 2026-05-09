import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BASEMAP_ID } from '../config/basemaps'

interface BasemapState {
  selectedId: string
  setSelected: (id: string) => void
}

export const useBasemapStore = create<BasemapState>()(
  persist(
    (set) => ({
      selectedId: DEFAULT_BASEMAP_ID,
      setSelected: (id) => set({ selectedId: id }),
    }),
    {
      name: 'basemap-storage',
    },
  ),
)
