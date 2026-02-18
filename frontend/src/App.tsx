import { useEffect } from 'react'
import { AppLayout } from './components/AppLayout'
import { useAuthStore } from './stores/authStore'
import './App.css'

function App() {
  const { verifyMagicLink, refreshProfile, logout } = useAuthStore()

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const token = urlParams.get('token')
    const emailAdded = urlParams.get('emailAdded')
    const merged = urlParams.get('merged')

    // Clean URL params
    if (token || emailAdded || merged) {
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    if (token) {
      verifyMagicLink(token)
    } else if (emailAdded) {
      refreshProfile()
    } else if (merged) {
      // Account was merged into another — log out current session since this account is deleted
      logout()
    }
  }, [verifyMagicLink, refreshProfile, logout])

  return <AppLayout />
}

export default App
