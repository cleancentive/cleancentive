import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Shown when this browser opened a magic link that completes a sign-in started
 * on another device.
 *
 * Completing it hands a session to whoever is polling for that request. That
 * used to happen automatically, which meant anyone could ask for a link to an
 * address they do not own, keep the request id, and be signed in as that person
 * the moment they clicked. This device is signed in either way; the only
 * question is whether the other one is too.
 */
export function CrossDeviceSignInPrompt() {
  const { t } = useTranslation(['auth', 'common'])
  const crossDeviceSignIn = useAuthStore((s) => s.crossDeviceSignIn)
  const confirmCrossDeviceSignIn = useAuthStore((s) => s.confirmCrossDeviceSignIn)
  const dismissCrossDeviceSignIn = useAuthStore((s) => s.dismissCrossDeviceSignIn)

  if (!crossDeviceSignIn) return null

  const browser = crossDeviceSignIn.browser || t('crossDevice.unknownBrowser')
  const location = crossDeviceSignIn.location || t('crossDevice.unknownLocation')

  return (
    <ConfirmDialog
      title={t('crossDevice.title')}
      actions={
        <>
          <button className="primary-button" onClick={() => void confirmCrossDeviceSignIn()}>
            {t('crossDevice.approve')}
          </button>
          <button className="secondary-button" onClick={() => void dismissCrossDeviceSignIn()}>
            {t('crossDevice.decline')}
          </button>
        </>
      }
    >
      <p>{t('crossDevice.body', { browser, location })}</p>
      <p className="confirm-dialog-hint">{t('crossDevice.hint')}</p>
    </ConfirmDialog>
  )
}
