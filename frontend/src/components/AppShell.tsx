import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { AuthButton } from './AuthButton'
import { GuestBanner } from './GuestBanner'
import { SignInModal } from './SignInModal'

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10L10 3l7 7" />
      <path d="M5 8.5V16a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V8.5" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  )
}

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
  { to: '/', label: 'Dashboard', icon: <HomeIcon />, end: true },
  { to: '/teams', label: 'Teams', icon: <TeamIcon /> },
  { to: '/cleanups', label: 'Cleanups', icon: <CleanupIcon /> },
  { to: '/profile', label: 'Profile', icon: <UserIcon /> },
  { to: '/map', label: 'Map', icon: <MapIcon /> },
  { to: '/admin', label: 'Admin', icon: <ShieldIcon />, adminOnly: true },
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

export function AppShell() {
  const { user, guestId } = useAuthStore()
  const { isAdmin, checkAdminStatus } = useAdminStore()
  const { isOnline, browserOnline, isForceOffline, setForceOffline } = useConnectivityStore()

  useEffect(() => {
    if (user) {
      checkAdminStatus()
    }
  }, [user, checkAdminStatus])

  const pickCount = useUiStore((s) => s.pickCount)
  const visibleItems = navItems.filter(item => !item.adminOnly || isAdmin)

  return (
    <div className="app">
      <header className="app-header">
        <h1>CleanCentive</h1>
        <nav className="nav-links">
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
            {user && (
              <Avatar
                userId={user.id}
                avatarEmailId={user.avatar_email_id}
                nickname={user.nickname}
                size={32}
              />
            )}
            <span>Welcome, {user?.nickname || 'Guest'}!</span>
            <AuthButton className={!user && pickCount > 0 ? 'sign-in-button' : 'logout-button'} />
          </div>
        )}
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <GuestBanner />

      <nav className="tab-bar">
        {visibleItems.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} className="tab-item">
            <span className="tab-icon">{item.icon}</span>
            <span className="tab-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <SignInModal />
    </div>
  )
}
