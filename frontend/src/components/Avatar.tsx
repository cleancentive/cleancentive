import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

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

  const showGravatar = !!avatarEmailId && !failed

  return showGravatar ? (
    <img
      key={`${avatarEmailId}-${cacheBust}`}
      className="avatar"
      src={`${API_BASE}/user/${userId}/avatar?v=${avatarEmailId}&t=${cacheBust}`}
      alt={nickname}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ borderRadius: '50%', objectFit: 'cover' }}
    />
  ) : (
    <img
      className="avatar"
      src="/avatars/default.svg"
      alt={nickname}
      width={size}
      height={size}
      style={{ borderRadius: '50%', objectFit: 'cover' }}
    />
  )
}
