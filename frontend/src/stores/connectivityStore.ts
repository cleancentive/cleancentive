import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ConnectivityState {
  browserOnline: boolean
  isForceOffline: boolean
  isOnline: boolean
  setForceOffline: (value: boolean) => void
}

function computeOnline(browserOnline: boolean, forceOffline: boolean): boolean {
  return browserOnline && !forceOffline
}

export const useConnectivityStore = create<ConnectivityState>()(
  persist(
    (set, get) => ({
      browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isForceOffline: false,
      isOnline: computeOnline(
        typeof navigator !== 'undefined' ? navigator.onLine : true,
        false,
      ),
      setForceOffline: (value: boolean) => {
        set({
          isForceOffline: value,
          isOnline: computeOnline(get().browserOnline, value),
        })
      },
    }),
    {
      name: 'connectivity-storage',
      partialize: (state) => ({ isForceOffline: state.isForceOffline }),
    },
  ),
)

// Listen for browser online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const { isForceOffline } = useConnectivityStore.getState()
    useConnectivityStore.setState({
      browserOnline: true,
      isOnline: computeOnline(true, isForceOffline),
    })
  })

  window.addEventListener('offline', () => {
    useConnectivityStore.setState({
      browserOnline: false,
      isOnline: false,
    })
  })
}
