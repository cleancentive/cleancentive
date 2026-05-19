import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { suggestNicknameFromEmail } from '../lib/nicknameSuggestion'
import { Avatar } from './Avatar'

export function UserDisplay({
  userId,
  avatarEmailId,
  uploadedAvatarUpdatedAt,
  nickname,
  size = 28,
  showAvatar = true,
  editableIfPlaceholder = false,
}: {
  userId: string
  avatarEmailId?: string | null
  uploadedAvatarUpdatedAt?: string | null
  nickname: string
  size?: number
  showAvatar?: boolean
  editableIfPlaceholder?: boolean
}) {
  const currentUser = useAuthStore((state) => state.user)
  const updateProfile = useAuthStore((state) => state.updateProfile)
  const clearError = useAuthStore((state) => state.clearError)
  const isPlaceholder = nickname === 'guest'
  const isOwn = currentUser?.id === userId
  const canEdit = editableIfPlaceholder && isPlaceholder && isOwn

  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  function startEditing() {
    setValue(suggestNicknameFromEmail(currentUser?.emails))
    setLocalError(null)
    setIsEditing(true)
  }

  function cancelEditing() {
    setIsEditing(false)
    setLocalError(null)
  }

  async function commit() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === 'guest') {
      cancelEditing()
      return
    }
    setSaving(true)
    setLocalError(null)
    await updateProfile({ nickname: trimmed })
    setSaving(false)
    const err = useAuthStore.getState().error
    if (err) {
      setLocalError(err)
      clearError()
      return
    }
    setIsEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditing()
    }
  }

  return (
    <span className="user-display">
      {showAvatar && (
        <Avatar
          userId={userId}
          avatarEmailId={avatarEmailId}
          uploadedAvatarUpdatedAt={uploadedAvatarUpdatedAt}
          nickname={nickname}
          size={size}
        />
      )}
      {isEditing ? (
        <span className="user-display-edit">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void commit()}
            disabled={saving}
            placeholder="Your name"
            aria-label="Nickname"
            className="user-display-edit-input"
          />
          {localError && <span className="user-display-edit-error">{localError}</span>}
        </span>
      ) : (
        <span
          className={`user-display-nickname${canEdit ? ' user-display-nickname--editable' : ''}`}
          onClick={canEdit ? startEditing : undefined}
          role={canEdit ? 'button' : undefined}
          tabIndex={canEdit ? 0 : undefined}
          onKeyDown={canEdit ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditing() } } : undefined}
        >
          {nickname}
        </span>
      )}
    </span>
  )
}
