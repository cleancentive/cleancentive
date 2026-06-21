import { useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useAdminStore } from '../../stores/adminStore'
import { formatBytes } from '../../utils/formatBytes'

export function StewardPurge() {
  const { t } = useTranslation(['steward', 'common'])
  const purgeStatus = useAdminStore((s) => s.purgeStatus)
  const fetchPurgeStatus = useAdminStore((s) => s.fetchPurgeStatus)

  useEffect(() => {
    fetchPurgeStatus()
  }, [fetchPurgeStatus])

  return (
    <fieldset className="page-card">
      <legend>{t('purge.legend')}</legend>
      {purgeStatus ? (
        <>
          <div className={`admin-purge-status ${purgeStatus.enabled ? 'admin-purge-status--enabled' : 'admin-purge-status--disabled'}`}>
            {purgeStatus.enabled ? (
              <strong>{t('purge.enabled', { count: purgeStatus.retentionDays })}</strong>
            ) : (
              <>
                <strong>{t('purge.disabled')}</strong>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                  <Trans t={t} i18nKey="purge.disabledHint" components={{ code: <code /> }} />
                </p>
              </>
            )}
          </div>
          {purgeStatus.enabled && (
            <div className="admin-purge-grid">
              <div className="admin-purge-stat">
                <strong>{formatBytes(purgeStatus.totalFreedBytes)}</strong>
                <span>{t('purge.totalFreed')}</span>
              </div>
              <div className="admin-purge-stat">
                <strong>{formatBytes(purgeStatus.lastFreedBytes)}</strong>
                <span>{t('purge.lastRunFreed')}</span>
              </div>
              <div className="admin-purge-stat">
                <strong>{purgeStatus.lastSpotsPurged}</strong>
                <span>{t('purge.lastRunSpots')}</span>
              </div>
              <div className="admin-purge-stat">
                <strong>{formatBytes(purgeStatus.estimatedPurgeBytes)}</strong>
                <span>{t('purge.estimatedNextPurge')}</span>
              </div>
              <div className="admin-purge-stat">
                <strong>{purgeStatus.estimatedPurgeCount.toLocaleString()}</strong>
                <span>{t('purge.eligibleSpots')}</span>
              </div>
              {purgeStatus.nextRunAt && (
                <div className="admin-purge-stat">
                  <strong>{new Date(purgeStatus.nextRunAt).toLocaleString()}</strong>
                  <span>{t('purge.nextRun')}</span>
                </div>
              )}
              {purgeStatus.lastRunAt && (
                <div className="admin-purge-stat">
                  <strong>{new Date(purgeStatus.lastRunAt).toLocaleString()}</strong>
                  <span>{t('purge.lastRun')}</span>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="loading">{t('purge.loading')}</p>
      )}
    </fieldset>
  )
}
