import { useEffect } from 'react'
import { useAdminStore } from '../../stores/adminStore'
import { formatBytes } from '../../utils/formatBytes'

export function StewardStorage() {
  const storageInsights = useAdminStore((s) => s.storageInsights)
  const fetchStorageInsights = useAdminStore((s) => s.fetchStorageInsights)

  useEffect(() => {
    fetchStorageInsights()
  }, [fetchStorageInsights])

  return (
    <fieldset className="page-card">
      <legend>Storage Insights</legend>
      {storageInsights ? (
        <>
          <div className="admin-storage-grid">
            <div className="admin-storage-card">
              <div className="admin-storage-value">{formatBytes(storageInsights.totalBytes)}</div>
              <div className="admin-storage-label">Total Volume</div>
            </div>
            <div className="admin-storage-card">
              <div className="admin-storage-value">{formatBytes(storageInsights.totalOriginalBytes)}</div>
              <div className="admin-storage-label">Originals</div>
            </div>
            <div className="admin-storage-card">
              <div className="admin-storage-value">{formatBytes(storageInsights.totalThumbnailBytes)}</div>
              <div className="admin-storage-label">Thumbnails</div>
            </div>
            <div className="admin-storage-card">
              <div className="admin-storage-value">{storageInsights.spotCount.toLocaleString()}</div>
              <div className="admin-storage-label">Total Spots</div>
            </div>
          </div>
          {storageInsights.growthRate.length > 0 && (
            <table className="admin-growth-table">
              <thead>
                <tr><th>Week</th><th>New Volume</th></tr>
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
        <p className="loading">Loading storage data...</p>
      )}
    </fieldset>
  )
}
