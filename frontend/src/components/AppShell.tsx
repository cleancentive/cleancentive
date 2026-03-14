import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'

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
  { to: '/profile', label: 'Profile', icon: <UserIcon /> },
  { to: '/map', label: 'Map', icon: <MapIcon /> },
  { to: '/admin', label: 'Admin', icon: <ShieldIcon />, adminOnly: true },
]

export function AppShell() {
  const { user, guestId, logout } = useAuthStore()
  const { isAdmin, checkAdminStatus } = useAdminStore()

  useEffect(() => {
    if (user) {
      checkAdminStatus()
    }
  }, [user, checkAdminStatus])

  const visibleItems = navItems.filter(item => !item.adminOnly || isAdmin)
  const isAuthenticated = !!user

  return (
    <div className="app">
      <header className="app-header">
        <h1>CleanCentive</h1>
        {isAuthenticated && (
          <nav className="nav-links">
            {visibleItems.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        {(user || guestId) && (
          <div className="user-menu">
            <span>Welcome, {user?.nickname || 'Guest'}!</span>
            {isAuthenticated && (
              <button onClick={logout} className="logout-button">
                Sign Out
              </button>
            )}
          </div>
        )}
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      {isAuthenticated && (
        <nav className="tab-bar">
          {visibleItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className="tab-item">
              <span className="tab-icon">{item.icon}</span>
              <span className="tab-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
