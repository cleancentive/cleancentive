import { useTranslation, Trans } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'

export function GuestBanner() {
  const { t } = useTranslation(['auth', 'common'])
  const { user, guestId } = useAuthStore()
  const { openSignInModal, pickCount } = useUiStore()

  if (user || !guestId || pickCount === 0) return null

  return (
    <div className="guest-banner">
      <div className="guest-banner-content">
        <div className="guest-info">
          <Avatar userId={guestId} nickname="Guest" size={32} />
          <div className="guest-text">
            <p><strong>{t('guestBanner.browsingAsGuest')}</strong></p>
            <p>
              <Trans
                t={t}
                i18nKey="guestBanner.signInToSave"
                components={{ signin: <button onClick={openSignInModal} className="link-button" /> }}
              />
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
