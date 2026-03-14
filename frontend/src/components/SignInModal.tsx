import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { SignIn } from './SignIn'

export function SignInModal() {
  const { signInModalOpen, closeSignInModal } = useUiStore()
  const user = useAuthStore((s) => s.user)

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

  if (!signInModalOpen) return null

  return (
    <div className="sign-in-overlay" onClick={closeSignInModal}>
      <div className="sign-in-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="sign-in-close" onClick={closeSignInModal} aria-label="Close">
          ×
        </button>
        <SignIn />
      </div>
    </div>
  )
}
