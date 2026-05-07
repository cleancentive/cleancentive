import { create } from 'zustand'

interface UiState {
  signInModalOpen: boolean
  openSignInModal: () => void
  closeSignInModal: () => void
  aboutModalOpen: boolean
  openAboutModal: () => void
  closeAboutModal: () => void
  pickCount: number
  setPickCount: (count: number) => void
}

export const useUiStore = create<UiState>()((set) => ({
  signInModalOpen: false,
  openSignInModal: () => set({ signInModalOpen: true }),
  closeSignInModal: () => set({ signInModalOpen: false }),
  aboutModalOpen: false,
  openAboutModal: () => set({ aboutModalOpen: true }),
  closeAboutModal: () => set({ aboutModalOpen: false }),
  pickCount: 0,
  setPickCount: (count: number) => set({ pickCount: count }),
}))
