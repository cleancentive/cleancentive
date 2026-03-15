import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AppLayout } from './components/AppLayout'
import { AdminPanel } from './components/AdminPanel'
import { ProfileEditor } from './components/ProfileEditor'
import { UserDetail } from './components/UserDetail'
import { TeamList } from './components/TeamList'
import { TeamDetail } from './components/TeamDetail'
import { CleanupList } from './components/CleanupList'
import { CleanupDetail } from './components/CleanupDetail'
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
        <Route element={<AppShell />}>
          <Route path="/" element={<AppLayout />} />
          <Route path="/teams" element={<TeamList />} />
          <Route path="/teams/:id" element={<TeamDetail />} />
          <Route path="/cleanups" element={<CleanupList />} />
          <Route path="/cleanups/:id" element={<CleanupDetail />} />
          <Route path="/profile" element={<ProfileEditor />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/admin/users/:id" element={<UserDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
