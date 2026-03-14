import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'

interface AuthButtonProps {
  className?: string
}

export function AuthButton({ className }: AuthButtonProps) {
  const { user, logout } = useAuthStore()
  const { openSignInModal } = useUiStore()

  if (user) {
    return (
      <button onClick={logout} className={className}>
        Sign Out
      </button>
    )
  }

  return (
    <button onClick={openSignInModal} className={className}>
      Sign In
    </button>
  )
}
