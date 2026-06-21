import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom'
import i18n from './i18n'
import { AppShell } from './components/AppShell'
import { AppLayout } from './components/AppLayout'
import { StewardLayout } from './components/steward/StewardLayout'
import { StewardOperations } from './components/steward/StewardOperations'
import { StewardStorage } from './components/steward/StewardStorage'
import { StewardPurge } from './components/steward/StewardPurge'
import { StewardUsers } from './components/steward/StewardUsers'
import { StewardFeedback } from './components/steward/StewardFeedback'
import { ProfileEditor } from './components/ProfileEditor'
import { UserDetail } from './components/UserDetail'
import { TeamList } from './components/TeamList'
import { TeamDetail } from './components/TeamDetail'
import { CleanupList } from './components/CleanupList'
import { CleanupDetail } from './components/CleanupDetail'
import { InsightsPage } from './components/InsightsPage'
import { MapPage } from './components/MapPage'
import { SpotDetail } from './components/SpotDetail'
import { FeedbackPage } from './components/FeedbackPage'
import { FeedbackNew } from './components/FeedbackNew'
import { DeviceAuthPage } from './components/DeviceAuthPage'
import { OidcAuthorize } from './components/OidcAuthorize'
import { useAuthStore, installAuthBroadcastListener } from './stores/authStore'
import { NavHistoryProvider } from './lib/navHistory'
import './App.css'

// Install the cross-tab broadcast listener once at module load so even tabs
// that don't render the AuthHandler (e.g. /steward) react to a sign-in
// happening in a sibling tab.
installAuthBroadcastListener()

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
      void verifyMagicLink(token).then(() => {
        // After a successful magic-link verify, sibling tabs in this browser
        // received the session via BroadcastChannel and are already signed in.
        // Try to close this redundant tab — browsers block window.close() when
        // the tab wasn't opened by a script (most email clicks), so this
        // silently no-ops, and the tab simply remains as the user's signed-in
        // view. The brief delay lets the broadcast fan out first.
        setTimeout(() => { window.close() }, 600)
      })
    } else if (emailAdded) {
      refreshProfile()
    } else if (merged) {
      logout()
    }
  }, [searchParams, navigate, verifyMagicLink, refreshProfile, logout])

  return null
}

// Apply the signed-in user's stored language preference. An explicit ?locale=
// override always wins (deep links, test scripts), so we skip the sync when one
// is present; otherwise the profile preference beats the cached/browser guess.
function LocaleSync() {
  const locale = useAuthStore((s) => s.user?.locale)

  useEffect(() => {
    const hasOverride = new URLSearchParams(window.location.search).has('locale')
    if (hasOverride || !locale) return
    if (i18n.resolvedLanguage !== locale) {
      void i18n.changeLanguage(locale)
    }
  }, [locale])

  return null
}

function App() {
  return (
    <BrowserRouter>
      <NavHistoryProvider>
      <AuthHandler />
      <LocaleSync />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<AppLayout />} />
          <Route path="/teams" element={<TeamList />} />
          <Route path="/teams/:id" element={<TeamDetail />} />
          <Route path="/cleanups" element={<CleanupList />} />
          <Route path="/cleanups/:id" element={<CleanupDetail />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/spots/:id" element={<SpotDetail />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/feedback/new" element={<FeedbackNew />} />
          <Route path="/feedback/:id" element={<FeedbackPage />} />
          <Route path="/profile" element={<ProfileEditor />} />
          <Route path="/steward" element={<StewardLayout />}>
            <Route index element={<Navigate to="feedback?status=new,acknowledged,in_progress" replace />} />
            <Route path="operations" element={<StewardOperations />} />
            <Route path="storage" element={<StewardStorage />} />
            <Route path="purge" element={<StewardPurge />} />
            <Route path="users" element={<StewardUsers />} />
            <Route path="feedback" element={<StewardFeedback />} />
            <Route path="feedback/:feedbackId" element={<StewardFeedback />} />
          </Route>
          <Route path="/steward/users/:id" element={<UserDetail />} />
          <Route path="/auth/device" element={<DeviceAuthPage />} />
          <Route path="/oidc/authorize" element={<OidcAuthorize />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </NavHistoryProvider>
    </BrowserRouter>
  )
}

export default App
