import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface AvatarProps {
  userId: string
  avatarEmailId?: string | null
  nickname: string
  size?: number
}

export function Avatar({ userId, avatarEmailId, nickname, size = 40 }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const [cacheBust, setCacheBust] = useState(0)

  // Reset error state and bust cache when the selected email changes
  useEffect(() => {
    setFailed(false)
    setCacheBust(Date.now())
  }, [avatarEmailId])

  // No picture set — show person icon
  if (!avatarEmailId) {
    return (
      <svg
        className="avatar"
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label={nickname}
        style={{ borderRadius: '50%', backgroundColor: '#e5e7eb', padding: size * 0.15 }}
      >
        <circle cx="10" cy="7" r="3" />
        <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      </svg>
    )
  }

  // Gravatar selected but failed to load — gray circle fallback
  if (failed) {
    return (
      <img
        className="avatar"
        src="/avatars/default.svg"
        alt={nickname}
        width={size}
        height={size}
        style={{ borderRadius: '50%', objectFit: 'cover', backgroundColor: '#e5e7eb' }}
      />
    )
  }

  // Gravatar available
  return (
    <img
      key={`${avatarEmailId}-${cacheBust}`}
      className="avatar"
      src={`${API_BASE}/user/${userId}/avatar?v=${avatarEmailId}&t=${cacheBust}`}
      alt={nickname}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ borderRadius: '50%', objectFit: 'cover', backgroundColor: '#e5e7eb' }}
    />
  )
}
