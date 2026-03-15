import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { SignIn } from './SignIn'
import { ConfirmDialog } from './ConfirmDialog'

export function SignInModal() {
  const { signInModalOpen, closeSignInModal, pickCount } = useUiStore()
  const { user, guestId, deleteGuestData, isLoading } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    if (user && signInModalOpen) {
      closeSignInModal()
    }
  }, [user, signInModalOpen, closeSignInModal])

  useEffect(() => {
    if (!signInModalOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSignInModal()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [signInModalOpen, closeSignInModal])

  useEffect(() => {
    if (!signInModalOpen) setShowDeleteConfirm(false)
  }, [signInModalOpen])

  if (!signInModalOpen) return null

  const showGuestDelete = !user && !!guestId && pickCount > 0

  return (
    <div className="sign-in-overlay" onClick={closeSignInModal}>
      <div className="sign-in-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="sign-in-close" onClick={closeSignInModal} aria-label="Close">
          ×
        </button>
        <SignIn />
        {showGuestDelete && (
          <div className="sign-in-guest-delete">
            <button
              className="link-button danger-link"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete guest data
            </button>
          </div>
        )}
        {showDeleteConfirm && (
          <ConfirmDialog
            title="Delete Guest Data"
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
                  Delete all data
                </button>
                <button
                  onClick={async () => {
                    await deleteGuestData('anonymize')
                    setShowDeleteConfirm(false)
                    closeSignInModal()
                  }}
                  className="secondary-button"
                >
                  Just forget me locally
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="secondary-button"
                >
                  Cancel
                </button>
              </>
            }
          >
            <p>This will remove all data associated with your guest session.</p>
          </ConfirmDialog>
        )}
      </div>
    </div>
  )
}
