import { useEffect } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { UserMenuButton } from './UserMenuButton'
import { GuestBanner } from './GuestBanner'
import { SignInModal } from './SignInModal'
import { FeedbackModal } from './FeedbackModal'
import { ErrorBoundary } from './ErrorBoundary'
import { ContextBar } from './ContextBar'
import { useFeedbackStore } from '../stores/feedbackStore'
import '../stores/partnerBrandingStore'

function MapIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4l5-1.5v13L2 17V4z" />
      <path d="M7 2.5l6 2v13l-6-2V2.5z" />
      <path d="M13 4.5l5-1.5v13l-5 1.5V4.5z" />
    </svg>
  )
}

function TeamIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="6" r="2.5" />
      <circle cx="13" cy="6" r="2.5" />
      <path d="M2 16c0-2.8 2.2-5 5-5s5 2.2 5 5" />
      <path d="M10.5 12.5c.7-1 1.8-1.5 3-1.5 2.5 0 4.5 2 4.5 4.5" />
    </svg>
  )
}

function CleanupIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2c1 2 3 3 3 6a3 3 0 01-6 0c0-3 2-4 3-6z" />
      <path d="M10 11v7" />
      <path d="M7 15l3-2 3 2" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17V9" />
      <path d="M7 17V5" />
      <path d="M11 17V11" />
      <path d="M15 17V3" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2L3 5.5v4.5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V5.5L10 2z" />
    </svg>
  )
}

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  adminOnly?: boolean
  end?: boolean
}

const navItems: NavItem[] = [
  { to: '/teams', label: 'Teams', icon: <TeamIcon /> },
  { to: '/cleanups', label: 'Cleanups', icon: <CleanupIcon /> },
  { to: '/insights', label: 'Insights', icon: <ChartIcon /> },
  { to: '/map', label: 'Map', icon: <MapIcon /> },
  { to: '/steward', label: 'Steward', icon: <ShieldIcon />, adminOnly: true },
]

function WifiIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 5.5a8.5 8.5 0 0 1 12 0" /><path d="M3.5 8a5 5 0 0 1 7 0" /><circle cx="7" cy="10.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  )
}

function WifiOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 5.5a8.5 8.5 0 0 1 3.2-1.8" /><path d="M9.8 3.7a8.5 8.5 0 0 1 3.2 1.8" /><path d="M3.5 8a5 5 0 0 1 2.5-1.3" /><path d="M8 6.7A5 5 0 0 1 10.5 8" /><circle cx="7" cy="10.5" r="0.75" fill="currentColor" stroke="none" /><line x1="2" y1="2" x2="12" y2="12" />
    </svg>
  )
}

function FeedbackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H7l-4 3v-3a1 1 0 01-1-1V4z" />
    </svg>
  )
}

export function AppShell() {
  const { user, guestId } = useAuthStore()
  const { isAdmin, checkAdminStatus } = useAdminStore()
  const { isOnline, browserOnline, isForceOffline, setForceOffline } = useConnectivityStore()
  const openFeedbackModal = useFeedbackStore((s) => s.openFeedbackModal)

  useEffect(() => {
    if (user) {
      checkAdminStatus()
    }
  }, [user, checkAdminStatus])

  const visibleItems = navItems.filter(item => !item.adminOnly || isAdmin)

  const partnerTeamName = user?.active_team_is_partner ? user.active_team_name : null

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <Link to="/" className="app-title-link">
            CleanCentive{partnerTeamName ? ` | ${partnerTeamName}` : ''}
          </Link>
        </h1>
        <nav className="nav-links">
          <Link to="/" className="nav-cta">Pick now!</Link>
          {visibleItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              {item.label}
            </NavLink>
          ))}
        </nav>
        {(user || guestId) && (
          <div className="user-menu">
            <button
              className={`connectivity-pill ${isOnline ? 'connectivity-pill--online' : 'connectivity-pill--offline'}`}
              onClick={() => browserOnline && setForceOffline(!isForceOffline)}
              disabled={!browserOnline}
              title={!browserOnline ? 'No network connection' : isForceOffline ? 'Click to go online' : 'Click to go offline'}
            >
              {isOnline ? <WifiIcon /> : <WifiOffIcon />}
              {!browserOnline ? 'No network' : isForceOffline ? 'Offline' : 'Online'}
            </button>
            <UserMenuButton />
          </div>
        )}
      </header>

      <ContextBar />

      <main className="app-main">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      <GuestBanner />

      <nav className="tab-bar">
        <NavLink to="/" end className="tab-item">
          <span className="tab-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="8" /><path d="M10 6v4l2.5 2.5" />
            </svg>
          </span>
          <span className="tab-label">Pick now!</span>
        </NavLink>
        {visibleItems.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} className="tab-item">
            <span className="tab-icon">{item.icon}</span>
            <span className="tab-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <button className="feedback-pill" onClick={() => openFeedbackModal()}>
        <FeedbackIcon /> Feedback
      </button>

      <SignInModal />
      <FeedbackModal />
    </div>
  )
}
