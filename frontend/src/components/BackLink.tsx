import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { usePreviousPath } from '../lib/navHistory'

// Native browser "go back" shortcut, for the tooltip. We can only know the OS
// default (not a user's custom remap), but that's the standard binding.
const platform =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
  navigator.platform ||
  navigator.userAgent
const isMac = /mac|iphone|ipad/i.test(platform)
const BACK_SHORTCUT = isMac ? '⌘←' : 'Alt+←'

// Friendly noun key for a route, used to phrase "Back to {noun}". Returns null
// for routes we don't have a good word for, so the caller's fallbackNoun is used.
function routeNounKey(pathname: string): string | null {
  if (pathname === '/') return 'home'
  if (pathname === '/map') return 'map'
  if (pathname.startsWith('/cleanups')) return 'cleanups'
  if (pathname.startsWith('/teams')) return 'teams'
  if (pathname.startsWith('/insights')) return 'insights'
  if (pathname.startsWith('/feedback')) return 'feedback'
  if (pathname.startsWith('/steward/users')) return 'users'
  if (pathname.startsWith('/steward')) return 'steward'
  return null
}

interface BackLinkProps {
  /** Fallback destination for direct landings / reloads / new tabs / right-click. */
  to: string
  /** Noun used when we can't tell where the user came from, e.g. "cleanups". */
  fallbackNoun: string
  className?: string
}

/**
 * A back link that mimics the browser Back button: when there's in-app history
 * it steps back via history.back() (restoring the previous page's exact scroll/
 * map viewport/etc.), and only falls back to `to` on a fresh entry. The label
 * adapts to where the user actually came from.
 */
export function BackLink({ to, fallbackNoun, className = 'back-link' }: BackLinkProps) {
  const { t } = useTranslation(['shell', 'common'])
  const navigate = useNavigate()
  const location = useLocation()
  const previousPath = usePreviousPath()

  // key === 'default' is React Router's marker for the first entry in this SPA
  // session (deep link / reload / new tab) — there's nothing in-app to pop.
  const hasInAppHistory = location.key !== 'default'
  const nounKey = hasInAppHistory ? routeNounKey(previousPath ?? '') : null
  const noun = nounKey ? t(`backLink.nouns.${nounKey}`) : fallbackNoun

  const onClick = (e: React.MouseEvent) => {
    // Let modifier / middle / right clicks use the native href (new tab, etc.).
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (hasInAppHistory) {
      e.preventDefault()
      navigate(-1)
    }
  }

  return (
    <Link to={to} className={className} onClick={onClick} title={t('backLink.title', { shortcut: BACK_SHORTCUT })}>
      &larr; {t('backLink.label', { noun })}
    </Link>
  )
}
