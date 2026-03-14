import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'

export function GuestBanner() {
  const { user, guestId } = useAuthStore()
  const { openSignInModal, pickCount } = useUiStore()

  if (user || !guestId || pickCount === 0) return null

  return (
    <div className="guest-banner">
      <div className="guest-banner-content">
        <div className="guest-info">
          <Avatar userId={guestId} nickname="Guest" size={32} />
          <div className="guest-text">
            <p><strong>You're browsing as a guest</strong></p>
            <p><button onClick={openSignInModal} className="link-button">Sign in</button> to save your progress and access all features</p>
          </div>
        </div>
      </div>
    </div>
  )
}
