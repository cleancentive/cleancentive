import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'

type Surface = 'cleanup-create' | 'team-create'

const COPY_KEY: Record<Surface, string> = {
  'cleanup-create': 'profileHint.cleanupCreate',
  'team-create': 'profileHint.teamCreate',
}

export function ProfileHintBanner({ surface }: { surface: Surface }) {
  const { t } = useTranslation(['auth', 'common'])
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
      <p className="profile-hint-banner-text">{t(COPY_KEY[surface])}</p>
      <div className="profile-hint-banner-actions">
        <Link to="/profile" className="link-button">{t('profileHint.editProfile')}</Link>
        <button type="button" className="link-button" onClick={() => dismissHint(key)}>
          {t('profileHint.notNow')}
        </button>
      </div>
    </div>
  )
}
