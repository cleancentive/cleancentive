import { create } from 'zustand'

interface UiState {
  signInModalOpen: boolean
  openSignInModal: () => void
  closeSignInModal: () => void
  pickCount: number
  setPickCount: (count: number) => void
}

export const useUiStore = create<UiState>()((set) => ({
  signInModalOpen: false,
  openSignInModal: () => set({ signInModalOpen: true }),
  closeSignInModal: () => set({ signInModalOpen: false }),
  pickCount: 0,
  setPickCount: (count: number) => set({ pickCount: count }),
}))
