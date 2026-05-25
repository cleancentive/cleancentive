import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_BASEMAP_THEME,
  mapLegacyBasemapIdToTheme,
  type BasemapTheme,
} from '../config/basemaps'

interface BasemapState {
  selectedTheme: BasemapTheme
  setSelectedTheme: (theme: BasemapTheme) => void
}

export const useBasemapStore = create<BasemapState>()(
  persist(
    (set) => ({
      selectedTheme: DEFAULT_BASEMAP_THEME,
      setSelectedTheme: (theme) => set({ selectedTheme: theme }),
    }),
    {
      name: 'basemap-storage',
      version: 2,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState

        if (version < 2) {
          const state = persistedState as { selectedId?: string }
          return {
            selectedTheme: mapLegacyBasemapIdToTheme(state.selectedId),
          }
        }

        return persistedState
      },
    },
  ),
)
