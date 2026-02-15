import { useEffect } from 'react'
import { AppLayout } from './components/AppLayout'
import { useAuthStore } from './stores/authStore'
import './App.css'

function App() {
  const { verifyMagicLink } = useAuthStore()

  useEffect(() => {
    // Check for magic link token in URL
    const urlParams = new URLSearchParams(window.location.search)
    const token = urlParams.get('token')

    if (token) {
      // Remove token from URL
      const newUrl = window.location.pathname
      window.history.replaceState({}, document.title, newUrl)

      // Verify the magic link
      verifyMagicLink(token)
    }
  }, [verifyMagicLink])

  return <AppLayout />
}

export default App