import { useEffect } from 'react'
import { useAdminStore } from '../../stores/adminStore'
import { formatBytes } from '../../utils/formatBytes'

export function StewardPurge() {
  const purgeStatus = useAdminStore((s) => s.purgeStatus)
  const fetchPurgeStatus = useAdminStore((s) => s.fetchPurgeStatus)

  useEffect(() => {
    fetchPurgeStatus()
  }, [fetchPurgeStatus])

  return (
    <fieldset className="page-card">
      <legend>Image Purge</legend>
      {purgeStatus ? (
        <>
          <div className={`admin-purge-status ${purgeStatus.enabled ? 'admin-purge-status--enabled' : 'admin-purge-status--disabled'}`}>
            {purgeStatus.enabled ? (
              <strong>Enabled — originals older than {purgeStatus.retentionDays} days are purged daily</strong>
            ) : (
              <>
                <strong>Disabled</strong>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                  Set <code>IMAGE_PURGE_RETENTION_DAYS</code> environment variable to enable automated purge of original images.
                </p>
              </>
            )}
          </div>
          {purgeStatus.enabled && (
            <div className="admin-purge-grid">
              <div className="admin-purge-stat">
                <strong>{formatBytes(purgeStatus.totalFreedBytes)}</strong>
                <span>Total Freed</span>
              </div>
              <div className="admin-purge-stat">
                <strong>{formatBytes(purgeStatus.lastFreedBytes)}</strong>
                <span>Last Run Freed</span>
              </div>
              <div className="admin-purge-stat">
                <strong>{purgeStatus.lastSpotsPurged}</strong>
                <span>Last Run Spots</span>
              </div>
              <div className="admin-purge-stat">
                <strong>{formatBytes(purgeStatus.estimatedPurgeBytes)}</strong>
                <span>Estimated Next Purge</span>
              </div>
              <div className="admin-purge-stat">
                <strong>{purgeStatus.estimatedPurgeCount.toLocaleString()}</strong>
                <span>Eligible Spots</span>
              </div>
              {purgeStatus.nextRunAt && (
                <div className="admin-purge-stat">
                  <strong>{new Date(purgeStatus.nextRunAt).toLocaleString()}</strong>
                  <span>Next Run</span>
                </div>
              )}
              {purgeStatus.lastRunAt && (
                <div className="admin-purge-stat">
                  <strong>{new Date(purgeStatus.lastRunAt).toLocaleString()}</strong>
                  <span>Last Run</span>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="loading">Loading purge status...</p>
      )}
    </fieldset>
  )
}
