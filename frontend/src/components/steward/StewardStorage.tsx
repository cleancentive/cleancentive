import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/adminStore'
import { formatBytes } from '../../utils/formatBytes'

export function StewardStorage() {
  const { t } = useTranslation(['steward', 'common'])
  const storageInsights = useAdminStore((s) => s.storageInsights)
  const fetchStorageInsights = useAdminStore((s) => s.fetchStorageInsights)

  useEffect(() => {
    fetchStorageInsights()
  }, [fetchStorageInsights])

  return (
    <fieldset className="page-card">
      <legend>{t('storage.legend')}</legend>
      {storageInsights ? (
        <>
          <div className="admin-storage-grid">
            <div className="admin-storage-card">
              <div className="admin-storage-value">{formatBytes(storageInsights.totalBytes)}</div>
              <div className="admin-storage-label">{t('storage.totalVolume')}</div>
            </div>
            <div className="admin-storage-card">
              <div className="admin-storage-value">{formatBytes(storageInsights.totalOriginalBytes)}</div>
              <div className="admin-storage-label">{t('storage.originals')}</div>
            </div>
            <div className="admin-storage-card">
              <div className="admin-storage-value">{formatBytes(storageInsights.totalThumbnailBytes)}</div>
              <div className="admin-storage-label">{t('storage.thumbnails')}</div>
            </div>
            <div className="admin-storage-card">
              <div className="admin-storage-value">{storageInsights.spotCount.toLocaleString()}</div>
              <div className="admin-storage-label">{t('storage.totalSpots')}</div>
            </div>
          </div>
          {storageInsights.growthRate.length > 0 && (
            <table className="admin-growth-table">
              <thead>
                <tr><th>{t('storage.week')}</th><th>{t('storage.newVolume')}</th></tr>
              </thead>
              <tbody>
                {storageInsights.growthRate.map((entry) => (
                  <tr key={entry.week}><td>{entry.week}</td><td>{formatBytes(entry.bytes)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="loading">{t('storage.loading')}</p>
      )}
    </fieldset>
  )
}
