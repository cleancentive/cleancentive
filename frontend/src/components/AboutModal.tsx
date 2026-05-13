import { useEffect } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useVersionStore } from '../stores/versionStore'
import { useEscapeKey } from '../hooks/useEscapeKey'

const REPO_URL = 'https://github.com/cleancentive/cleancentive'
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`

export function AboutModal() {
  const { aboutModalOpen, closeAboutModal } = useUiStore()
  const { versionInfo, fetchVersionInfo } = useVersionStore()

  useEffect(() => {
    if (aboutModalOpen) fetchVersionInfo()
  }, [aboutModalOpen, fetchVersionInfo])

  useEscapeKey(aboutModalOpen, closeAboutModal)

  if (!aboutModalOpen) return null

  const frontShort = __APP_COMMIT_SHORT__
  const backShort = versionInfo?.backend?.commitShort ?? '?'
  const workerShort = versionInfo?.worker?.commitShort ?? '?'
  const combinedVersion = `${frontShort}-${backShort}-${workerShort}`
  const versionTitle = [
    `frontend ${__APP_COMMIT__}`,
    `backend ${versionInfo?.backend?.commit ?? '?'}`,
    `worker ${versionInfo?.worker?.commit ?? '?'}`,
  ].join('\n')

  return (
    <div className="about-modal-overlay" onClick={closeAboutModal}>
      <div className="about-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="about-modal-close" onClick={closeAboutModal} aria-label="Close">
          ×
        </button>
        <h2 className="about-modal-title">CleanCentive</h2>
        <p className="about-modal-description">Empowering communities to make the world visibly cleaner.</p>
        <dl className="about-modal-rows">
          <div className="about-modal-row">
            <dt>Version</dt>
            <dd title={versionTitle}>{combinedVersion}</dd>
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
