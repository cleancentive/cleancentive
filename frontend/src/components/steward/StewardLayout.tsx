import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Outlet } from 'react-router-dom'
import { useAdminStore } from '../../stores/adminStore'
import { useAuthStore } from '../../stores/authStore'

function OperationsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 1.8v2.4M10 15.8v2.4M3.2 3.2l1.7 1.7M15.1 15.1l1.7 1.7M1.8 10h2.4M15.8 10h2.4M3.2 16.8l1.7-1.7M15.1 4.9l1.7-1.7" />
    </svg>
  )
}

function StorageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="10" cy="4.5" rx="6" ry="2" />
      <path d="M4 4.5v4c0 1.1 2.7 2 6 2s6-.9 6-2v-4" />
      <path d="M4 10.5v4c0 1.1 2.7 2 6 2s6-.9 6-2v-4" />
    </svg>
  )
}

function PurgeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h14" />
      <path d="M5 5v11a2 2 0 002 2h6a2 2 0 002-2V5" />
      <path d="M8 5V3a1 1 0 011-1h2a1 1 0 011 1v2" />
      <path d="M8.5 9v6M11.5 9v6" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="7" r="3" />
      <path d="M2 17c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5" />
      <circle cx="15" cy="6" r="2" />
      <path d="M14 11.5c2 0 4 1.5 4 4" />
    </svg>
  )
}

function FeedbackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H8l-4 3v-3H5a2 2 0 01-2-2V4z" />
    </svg>
  )
}

const TABS: Array<{ to: string; label: string; icon: ReactNode }> = [
  { to: 'feedback', label: 'Feedback', icon: <FeedbackIcon /> },
  { to: 'users', label: 'Users', icon: <UsersIcon /> },
  { to: 'operations', label: 'Operations', icon: <OperationsIcon /> },
  { to: 'storage', label: 'Storage', icon: <StorageIcon /> },
  { to: 'purge', label: 'Purge', icon: <PurgeIcon /> },
]

export function StewardLayout() {
  const { user } = useAuthStore()
  const isAdmin = useAdminStore((s) => s.isAdmin)
  const checkAdminStatus = useAdminStore((s) => s.checkAdminStatus)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    checkAdminStatus().then(() => setChecked(true))
  }, [checkAdminStatus])

  if (!user) {
    return <Navigate to="/" replace />
  }

  if (!checked) {
    return <div className="admin-panel"><p className="loading">Loading...</p></div>
  }

  if (!isAdmin) {
    return (
      <div className="admin-panel">
        <div className="access-denied">
          <h2>Access Denied</h2>
          <p>You do not have steward privileges.</p>
          <Link to="/">Go Home</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-panel">
      <div className="steward-shell">
        <nav className="steward-dock" aria-label="Steward sections">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              title={tab.label}
              className={({ isActive }) => `steward-dock-item${isActive ? ' steward-dock-item--active' : ''}`}
            >
              {tab.icon}
              <span className="steward-dock-label">{tab.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="steward-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
