import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'

function UserIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
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
  const { openSignInModal, pickCount } = useUiStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

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
          nickname={user.nickname}
          size={32}
        />
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <button
            className="user-menu-dropdown-item"
            onClick={() => { setOpen(false); navigate('/profile') }}
          >
            <UserIcon />
            Profile
          </button>
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
    </div>
  )
}
