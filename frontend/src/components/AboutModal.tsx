import { useEffect } from 'react'
import { useUiStore } from '../stores/uiStore'

const REPO_URL = 'https://github.com/cleancentive/cleancentive'
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`

export function AboutModal() {
  const { aboutModalOpen, closeAboutModal } = useUiStore()

  useEffect(() => {
    if (!aboutModalOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAboutModal()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [aboutModalOpen, closeAboutModal])

  if (!aboutModalOpen) return null

  return (
    <div className="about-modal-overlay" onClick={closeAboutModal}>
      <div className="about-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="about-modal-close" onClick={closeAboutModal} aria-label="Close">
          ×
        </button>
        <h2 className="about-modal-title">About CleanCentive</h2>
        <p className="about-modal-description">Gamified neighborhood cleanup tracking.</p>
        <dl className="about-modal-rows">
          <div className="about-modal-row">
            <dt>Version</dt>
            <dd>{__APP_VERSION__}</dd>
          </div>
          <div className="about-modal-row">
            <dt>Source</dt>
            <dd>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </dd>
          </div>
          <div className="about-modal-row">
            <dt>License</dt>
            <dd>
              <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
                AGPL-3.0
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
