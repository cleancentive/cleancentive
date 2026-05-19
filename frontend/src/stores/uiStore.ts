import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  signInModalOpen: boolean
  openSignInModal: () => void
  closeSignInModal: () => void
  aboutModalOpen: boolean
  openAboutModal: () => void
  closeAboutModal: () => void
  pickCount: number
  setPickCount: (count: number) => void
  dismissedHints: Record<string, true>
  dismissHint: (key: string) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      signInModalOpen: false,
      openSignInModal: () => set({ signInModalOpen: true }),
      closeSignInModal: () => set({ signInModalOpen: false }),
      aboutModalOpen: false,
      openAboutModal: () => set({ aboutModalOpen: true }),
      closeAboutModal: () => set({ aboutModalOpen: false }),
      pickCount: 0,
      setPickCount: (count: number) => set({ pickCount: count }),
      dismissedHints: {},
      dismissHint: (key: string) =>
        set((state) => ({ dismissedHints: { ...state.dismissedHints, [key]: true } })),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({ dismissedHints: state.dismissedHints }),
    },
  ),
)
