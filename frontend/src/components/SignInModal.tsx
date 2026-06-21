import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { SignIn } from './SignIn'
import { ConfirmDialog } from './ConfirmDialog'
import { useEscapeKey } from '../hooks/useEscapeKey'

export function SignInModal() {
  const { t } = useTranslation(['auth', 'common'])
  const { signInModalOpen, closeSignInModal, pickCount } = useUiStore()
  const { user, guestId, deleteGuestData, isLoading } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    if (user && signInModalOpen) {
      closeSignInModal()
    }
  }, [user, signInModalOpen, closeSignInModal])

  useEscapeKey(signInModalOpen, closeSignInModal)

  useEffect(() => {
    if (!signInModalOpen) setShowDeleteConfirm(false)
  }, [signInModalOpen])

  if (!signInModalOpen) return null

  const showGuestDelete = !user && !!guestId && pickCount > 0

  return (
    <div className="sign-in-overlay" onClick={closeSignInModal}>
      <div className="sign-in-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="sign-in-close" onClick={closeSignInModal} aria-label={t('modal.closeLabel')}>
          ×
        </button>
        <SignIn />
        {showGuestDelete && (
          <div className="sign-in-guest-delete">
            <button
              className="link-button danger-link"
              onClick={() => setShowDeleteConfirm(true)}
            >
              {t('modal.deleteGuestData')}
            </button>
          </div>
        )}
        {showDeleteConfirm && (
          <ConfirmDialog
            title={t('guestData.title')}
            actions={
              <>
                <button
                  onClick={async () => {
                    await deleteGuestData('delete')
                    setShowDeleteConfirm(false)
                    closeSignInModal()
                  }}
                  disabled={!isOnline || isLoading}
                  className="danger-button"
                >
                  {t('guestData.deleteAll')}
                </button>
                <button
                  onClick={async () => {
                    await deleteGuestData('anonymize')
                    setShowDeleteConfirm(false)
                    closeSignInModal()
                  }}
                  className="secondary-button"
                >
                  {t('guestData.forgetLocally')}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="secondary-button"
                >
                  {t('common:actions.cancel')}
                </button>
              </>
            }
          >
            <p>{t('guestData.prompt')}</p>
          </ConfirmDialog>
        )}
      </div>
    </div>
  )
}
