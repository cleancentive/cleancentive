import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { buildQrCodeSvg } from '../lib/qrCode'
import { Avatar } from './Avatar'
import { UserDisplay } from './UserDisplay'
import faviconSvg from '../../public/favicon.svg?raw'

const FAVICON_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(faviconSvg)}`

function UserIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
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

function QrCodeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h5v5H3V3z" />
      <path d="M12 3h5v5h-5V3z" />
      <path d="M3 12h5v5H3v-5z" />
      <path d="M12 12h2" />
      <path d="M16 12h1v1" />
      <path d="M12 15h1v2" />
      <path d="M15 15h2v2" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9v5" />
      <circle cx="10" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3" />
      <path d="M14 14l4-4-4-4" />
      <path d="M18 10H8" />
    </svg>
  )
}

export function UserMenuButton() {
  const { user, logout } = useAuthStore()
  const { openSignInModal, openAboutModal, pickCount } = useUiStore()
  const [open, setOpen] = useState(false)
  const [shareQrOpen, setShareQrOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const instanceUrl = window.location.origin
  const qrCodeSvg = buildQrCodeSvg(instanceUrl, { centerImage: { href: FAVICON_DATA_URI, sizeModules: 5 } })

  const handleCopyInstanceUrl = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(instanceUrl)
      } else {
        copyTextWithFallback(instanceUrl)
      }
      setCopyStatus('copied')
    } catch {
      try {
        copyTextWithFallback(instanceUrl)
        setCopyStatus('copied')
      } catch {
        setCopyStatus('failed')
      }
    }
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  // Guest (with or without guestId): click opens sign-in modal
  if (!user) {
    return (
      <button
        className={`user-menu-button user-menu-button--icon${pickCount > 0 ? ' user-menu-button--cta' : ''}`}
        onClick={openSignInModal}
        aria-label="Sign in"
      >
        <UserIcon size={20} />
      </button>
    )
  }

  // Logged in: click toggles dropdown — Avatar handles both gravatar and no-picture states
  return (
    <div className="user-menu-wrapper" ref={ref}>
      <button
        className="user-menu-button"
        onClick={() => setOpen(!open)}
        aria-label="User menu"
        aria-expanded={open}
      >
        <Avatar
          userId={user.id}
          avatarEmailId={user.avatar_email_id}
          uploadedAvatarUpdatedAt={user.uploaded_avatar_updated_at}
          nickname={user.nickname}
          size={32}
        />
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-dropdown-identity">
            <UserDisplay
              userId={user.id}
              avatarEmailId={user.avatar_email_id}
              uploadedAvatarUpdatedAt={user.uploaded_avatar_updated_at}
              nickname={user.nickname}
              size={28}
              showAvatar={false}
              editableIfPlaceholder
            />
          </div>
          <div className="user-menu-dropdown-divider" />
          <button
            className="user-menu-dropdown-item"
            onClick={() => { setOpen(false); navigate('/profile') }}
          >
            <UserIcon />
            Profile
          </button>
          <button
            className="user-menu-dropdown-item"
            onClick={() => { setOpen(false); navigate('/feedback') }}
          >
            <FeedbackIcon />
            My Feedback
          </button>
          <button
            className="user-menu-dropdown-item"
            onClick={() => { setOpen(false); setCopyStatus('idle'); setShareQrOpen(true) }}
          >
            <QrCodeIcon />
            Share
          </button>
          <button
            className="user-menu-dropdown-item"
            onClick={() => { setOpen(false); openAboutModal() }}
          >
            <InfoIcon />
            About
          </button>
          {(user.active_team_name || user.active_cleanup_name) && (
            <>
              <div className="user-menu-dropdown-divider" />
              {user.active_team_name && (
                <div className="user-menu-dropdown-context">
                  <span className="user-menu-context-label">Team:</span> {user.active_team_name}
                </div>
              )}
              {user.active_cleanup_name && (
                <div className="user-menu-dropdown-context">
                  <span className="user-menu-context-label">Cleanup:</span> {user.active_cleanup_name}
                </div>
              )}
            </>
          )}
          <div className="user-menu-dropdown-divider" />
          <button
            className="user-menu-dropdown-item"
            onClick={() => { setOpen(false); logout() }}
          >
            <LogoutIcon />
            Sign Out
          </button>
        </div>
      )}
      {shareQrOpen && (
        <div className="share-qr-modal-overlay" role="presentation" onClick={() => setShareQrOpen(false)}>
          <div className="share-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="share-qr-title" onClick={(e) => e.stopPropagation()}>
            <button className="share-qr-close" onClick={() => setShareQrOpen(false)} aria-label="Close QR code dialog">×</button>
            <h2 id="share-qr-title">Share CleanCentive</h2>
            <div className="share-qr-code" dangerouslySetInnerHTML={{ __html: qrCodeSvg }} />
            <button className="share-qr-url" onClick={handleCopyInstanceUrl} type="button">
              <span>{instanceUrl}</span>
            </button>
            <p className="share-qr-copy-status" aria-live="polite">
              {copyStatus === 'copied' ? 'Copied to clipboard' : copyStatus === 'failed' ? 'Copy failed' : 'Tap URL to copy'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function copyTextWithFallback(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-1000px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('Copy command failed')
}
