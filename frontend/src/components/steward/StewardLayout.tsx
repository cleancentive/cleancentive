import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, NavLink, Outlet } from 'react-router-dom'
import { useAdminStore } from '../../stores/adminStore'
import { useAuthStore } from '../../stores/authStore'
import { UMAMI_SHARE_URL } from '../../lib/analytics'
import { WIKI_URL } from '../../lib/wikiUrl'

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

function ReviewIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 10s2.8-4.5 7.5-4.5S17.5 10 17.5 10s-2.8 4.5-7.5 4.5S2.5 10 2.5 10z" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  )
}

function ProjectIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 16.5V3" />
      <path d="M2.5 16.5H17" />
      <path d="M6 13.5v-4M10 13.5v-7M14 13.5v-2.5" />
    </svg>
  )
}

function AnalyticsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12.5l4-4.5 3.5 3 5-6" />
      <path d="M12 5h3.5v3.5" />
      <path d="M2.5 16.5H17" />
    </svg>
  )
}

function WikiIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5A1.5 1.5 0 014.5 3H16v11H4.5A1.5 1.5 0 003 15.5z" />
      <path d="M3 15.5A1.5 1.5 0 004.5 17H16" />
      <path d="M7 6.5h5.5M7 9.5h5.5" />
    </svg>
  )
}

const TABS: Array<{ to: string; labelKey: string; icon: ReactNode }> = [
  { to: 'feedback?status=new,acknowledged,in_progress', labelKey: 'nav.feedback', icon: <FeedbackIcon /> },
  { to: 'review', labelKey: 'nav.review', icon: <ReviewIcon /> },
  { to: 'users', labelKey: 'nav.users', icon: <UsersIcon /> },
  { to: 'operations', labelKey: 'nav.operations', icon: <OperationsIcon /> },
  { to: 'project', labelKey: 'nav.project', icon: <ProjectIcon /> },
  { to: 'storage', labelKey: 'nav.storage', icon: <StorageIcon /> },
  { to: 'purge', labelKey: 'nav.purge', icon: <PurgeIcon /> },
]

export function StewardLayout() {
  const { t } = useTranslation(['steward', 'common'])
  const { user } = useAuthStore()
  const isAdmin = useAdminStore((s) => s.isAdmin)
  const stewardWikiCollectionId = useAdminStore((s) => s.stewardWikiCollectionId)
  const checkAdminStatus = useAdminStore((s) => s.checkAdminStatus)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    checkAdminStatus().then(() => setChecked(true))
  }, [checkAdminStatus])

  if (!user) {
    return <Navigate to="/" replace />
  }

  if (!checked) {
    return <div className="admin-panel"><p className="loading">{t('loading')}</p></div>
  }

  if (!isAdmin) {
    return (
      <div className="admin-panel">
        <div className="access-denied">
          <h2>{t('accessDenied.title')}</h2>
          <p>{t('accessDenied.message')}</p>
          <Link to="/">{t('accessDenied.goHome')}</Link>
        </div>
      </div>
    )
  }

  // Tools that live outside the app. The wiki deep-links into the stewards'
  // private collection when the backend knows its id, and falls back to the
  // wiki root before Outline has been bootstrapped.
  const externalLinks: Array<{ href: string; labelKey: string; icon: ReactNode }> = []
  if (UMAMI_SHARE_URL) {
    externalLinks.push({ href: UMAMI_SHARE_URL, labelKey: 'nav.analytics', icon: <AnalyticsIcon /> })
  }
  if (WIKI_URL) {
    externalLinks.push({
      href: stewardWikiCollectionId ? `${WIKI_URL}/collection/${stewardWikiCollectionId}` : WIKI_URL,
      labelKey: 'nav.wiki',
      icon: <WikiIcon />,
    })
  }

  return (
    <div className="admin-panel">
      <div className="steward-shell">
        <nav className="steward-dock" aria-label={t('nav.sectionsLabel')}>
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              title={t(tab.labelKey)}
              className={({ isActive }) => `steward-dock-item${isActive ? ' steward-dock-item--active' : ''}`}
            >
              {tab.icon}
              <span className="steward-dock-label">{t(tab.labelKey)}</span>
            </NavLink>
          ))}

          {externalLinks.length > 0 && <span className="steward-dock-divider" aria-hidden="true" />}
          {externalLinks.map((link) => (
            <a
              key={link.labelKey}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              title={t(link.labelKey)}
              className="steward-dock-item steward-dock-item--external"
            >
              {link.icon}
              <span className="steward-dock-label">{t(link.labelKey)}</span>
            </a>
          ))}
        </nav>
        <div className="steward-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
