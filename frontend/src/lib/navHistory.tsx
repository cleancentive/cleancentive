import { createContext, useContext, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

// Tracks the pathname of the entry *before* the current one, so a back link can
// phrase itself after where the user actually came from ("Back to map" vs.
// "Back to cleanups") instead of a hardcoded destination. The action is always
// a plain history.back(); this only informs the wording.
const PreviousPathContext = createContext<string | null>(null)

export function NavHistoryProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const currentRef = useRef<string | null>(null)
  const previousRef = useRef<string | null>(null)
  // Mutating refs during render is intentional and idempotent: on a genuine
  // pathname change we shift current → previous; StrictMode's double render and
  // re-renders without a path change are no-ops. Mirrors the initialUrlStateRef
  // pattern in MapPage.
  if (currentRef.current !== location.pathname) {
    previousRef.current = currentRef.current
    currentRef.current = location.pathname
  }
  return (
    <PreviousPathContext.Provider value={previousRef.current}>
      {children}
    </PreviousPathContext.Provider>
  )
}

export function usePreviousPath(): string | null {
  return useContext(PreviousPathContext)
}
