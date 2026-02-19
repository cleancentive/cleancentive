import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { AdminPanel } from './components/AdminPanel'
import { UserDetail } from './components/UserDetail'
import { useAuthStore } from './stores/authStore'
import './App.css'

function AuthHandler() {
  const { verifyMagicLink, refreshProfile, logout } = useAuthStore()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    const token = searchParams.get('token')
    const emailAdded = searchParams.get('emailAdded')
    const merged = searchParams.get('merged')

    if (token || emailAdded || merged) {
      navigate(window.location.pathname, { replace: true })
    }

    if (token) {
      verifyMagicLink(token)
    } else if (emailAdded) {
      refreshProfile()
    } else if (merged) {
      logout()
    }
  }, [searchParams, navigate, verifyMagicLink, refreshProfile, logout])

  return null
}

function App() {
  return (
    <BrowserRouter>
      <AuthHandler />
      <Routes>
        <Route path="/" element={<AppLayout />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/admin/users/:id" element={<UserDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
