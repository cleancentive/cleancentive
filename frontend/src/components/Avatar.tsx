import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { API_BASE } from '../lib/apiBase'

interface AvatarProps {
  userId: string
  avatarEmailId?: string | null
  uploadedAvatarUpdatedAt?: string | null
  nickname: string
  size?: number
}

const PALETTE = ['sage', 'terracotta', 'sand', 'moss', 'slate-blue', 'dusty-rose', 'ochre'] as const

function paletteIndexFor(userId: string): number {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % PALETTE.length
}

function initialFor(nickname: string): string {
  const first = nickname.trim()[0]
  return first ? first.toUpperCase() : '?'
}

const OVERLAY_MIN_SIZE = 24

export function Avatar({
  userId,
  avatarEmailId,
  uploadedAvatarUpdatedAt,
  nickname,
  size = 40,
}: AvatarProps) {
  const { t } = useTranslation(['teams', 'common'])
  const [failed, setFailed] = useState(false)
  const [cacheBust, setCacheBust] = useState(0)
  const currentUser = useAuthStore((state) => state.user)

  const version = uploadedAvatarUpdatedAt || avatarEmailId || null

  useEffect(() => {
    setFailed(false)
    setCacheBust(Date.now())
  }, [version])

  const isOwn = !!currentUser && currentUser.id === userId
  const isIncomplete =
    !!currentUser &&
    currentUser.nickname === 'guest' &&
    !currentUser.avatar_email_id &&
    !currentUser.uploaded_avatar_key

  const initials = (
    <span
      className={`avatar avatar--initials avatar--color-${PALETTE[paletteIndexFor(userId)]}`}
      role="img"
      aria-label={nickname}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initialFor(nickname)}
    </span>
  )

  const inner = !version || failed ? initials : (
    <img
      key={`${version}-${cacheBust}`}
      className="avatar"
      src={`${API_BASE}/user/${userId}/avatar?v=${version}&t=${cacheBust}`}
      alt={nickname}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', backgroundColor: 'var(--gray-200)' }}
    />
  )

  if (!isOwn || !isIncomplete || size < OVERLAY_MIN_SIZE) {
    return inner
  }

  const overlaySize = Math.max(14, Math.round(size * 0.35))
  return (
    <span className="avatar-wrapper" style={{ width: size, height: size }}>
      {inner}
      <Link
        to="/profile#picture"
        className="avatar-edit-overlay"
        onClick={(e) => e.stopPropagation()}
        aria-label={t('avatar.setPhoto')}
        style={{ width: overlaySize, height: overlaySize }}
      >
        <svg width="60%" height="60%" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 14.5V17h2.5L15 7.5 12.5 5 3 14.5z" />
          <path d="M12.5 5L15 7.5" />
        </svg>
      </Link>
    </span>
  )
}
