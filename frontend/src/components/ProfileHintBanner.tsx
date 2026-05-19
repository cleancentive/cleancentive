import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'

type Surface = 'cleanup-create' | 'team-create'

const COPY: Record<Surface, string> = {
  'cleanup-create':
    "Participants will see you as the organizer. Add a name or photo so people know who's hosting.",
  'team-create':
    "Members will see you as the team's founder. A name or photo makes the team feel less anonymous.",
}

export function ProfileHintBanner({ surface }: { surface: Surface }) {
  const user = useAuthStore((state) => state.user)
  const dismissedHints = useUiStore((state) => state.dismissedHints)
  const dismissHint = useUiStore((state) => state.dismissHint)
  const key = `profile-hint-${surface}`

  if (!user) return null
  const isIncomplete =
    user.nickname === 'guest' && !user.avatar_email_id && !user.uploaded_avatar_key
  if (!isIncomplete) return null
  if (dismissedHints[key]) return null

  return (
    <div className="profile-hint-banner">
      <Avatar
        userId={user.id}
        avatarEmailId={user.avatar_email_id}
        uploadedAvatarUpdatedAt={user.uploaded_avatar_updated_at}
        nickname={user.nickname}
        size={32}
      />
      <p className="profile-hint-banner-text">{COPY[surface]}</p>
      <div className="profile-hint-banner-actions">
        <Link to="/profile" className="link-button">Edit profile</Link>
        <button type="button" className="link-button" onClick={() => dismissHint(key)}>
          Not now
        </button>
      </div>
    </div>
  )
}
