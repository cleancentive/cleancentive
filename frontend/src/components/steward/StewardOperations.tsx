import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/adminStore'
import { useConnectivityStore } from '../../stores/connectivityStore'
import { formatTimestamp } from '../../utils/formatTimestamp'
import { CountdownButton } from '../CountdownButton'

function formatAge(seconds: number | null) {
  if (seconds === null) {
    return 'n/a'
  }

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainderSeconds = seconds % 60
  if (minutes < 60) {
    return `${minutes}m ${remainderSeconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  return `${hours}h ${remainderMinutes}m`
}

export function StewardOperations() {
  const { t } = useTranslation(['steward', 'common'])
  const { isOnline } = useConnectivityStore()
  const opsOverview = useAdminStore((s) => s.opsOverview)
  const isLoadingOps = useAdminStore((s) => s.isLoadingOps)
  const isRetryingFailedSpots = useAdminStore((s) => s.isRetryingFailedSpots)
  const retryFailedSpotsResult = useAdminStore((s) => s.retryFailedSpotsResult)
  const fetchOpsOverview = useAdminStore((s) => s.fetchOpsOverview)
  const retryFailedSpots = useAdminStore((s) => s.retryFailedSpots)
  const cleanOrphanedFailedJobs = useAdminStore((s) => s.cleanOrphanedFailedJobs)
  const isCleaningOrphanedJobs = useAdminStore((s) => s.isCleaningOrphanedJobs)

  const [retryBatchSize, setRetryBatchSize] = useState('10')

  useEffect(() => {
    fetchOpsOverview()
  }, [fetchOpsOverview])

  const parsedRetryBatchSize = Number.parseInt(retryBatchSize, 10)
  const retryLimit = Number.isFinite(parsedRetryBatchSize) && parsedRetryBatchSize > 0 ? parsedRetryBatchSize : 10

  return (
    <fieldset className="page-card ops-overview-panel">
      <legend>{t('operations.legend')}</legend>
      <div className="ops-overview-header">
        <div>
          <p>
            {opsOverview
              ? t('operations.updated', { time: new Date(opsOverview.timestamp).toLocaleTimeString() })
              : t('operations.liveStatus')}
          </p>
        </div>
        <CountdownButton
          intervalSeconds={5}
          isLoading={isLoadingOps}
          disabled={!isOnline || isRetryingFailedSpots}
          onRefresh={fetchOpsOverview}
        />
      </div>

      {(opsOverview?.spots.counts.failed ?? 0) + (opsOverview?.spots.stalled ?? 0) > 0 && (
        <div className="ops-actions-row">
          <label className="ops-batch-label">
            {t('operations.retryBatchSize')}
            <input
              type="number"
              min="1"
              max="100"
              value={retryBatchSize}
              onChange={(e) => setRetryBatchSize(e.target.value)}
              className="ops-batch-input"
            />
          </label>
          <button
            type="button"
            className="ops-retry-button"
            onClick={() => retryFailedSpots(retryLimit)}
            disabled={!isOnline || isRetryingFailedSpots || isLoadingOps}
          >
            {isRetryingFailedSpots ? t('operations.retrying') : t('operations.retryFailedSpots')}
          </button>
          {retryFailedSpotsResult && <p className="ops-retry-result">{retryFailedSpotsResult}</p>}
        </div>
      )}

      {(opsOverview?.queue.counts.failed ?? 0) > 0 && (
        <div className="ops-actions-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() => cleanOrphanedFailedJobs()}
            disabled={!isOnline || isCleaningOrphanedJobs || isLoadingOps}
          >
            {isCleaningOrphanedJobs ? t('operations.cleaningOrphanedJobs') : t('operations.cleanOrphanedJobs')}
          </button>
        </div>
      )}

      <div className="ops-metrics-grid">
        <article className="ops-card ops-card-status">
          <span className={`ops-status-pill ops-status-${opsOverview?.health.status || 'degraded'}`}>
            {opsOverview?.health.status || t('operations.statusLoading')}
          </span>
          <h3>{t('operations.systemHealth')}</h3>
          <p>
            {opsOverview?.worker.healthy ? t('operations.workerHeartbeatFresh') : t('operations.workerHeartbeatStale')}
          </p>
        </article>

        <article className="ops-card">
          <h3>{t('operations.queue')}</h3>
          <dl className="ops-key-values">
            <div><dt>{t('operations.queueWaiting')}</dt><dd>{opsOverview?.queue.counts.waiting ?? '-'}</dd></div>
            <div><dt>{t('operations.queueActive')}</dt><dd>{opsOverview?.queue.counts.active ?? '-'}</dd></div>
            <div><dt>{t('operations.queueDelayed')}</dt><dd>{opsOverview?.queue.counts.delayed ?? '-'}</dd></div>
            <div><dt>{t('operations.queueFailed')}</dt><dd>{opsOverview?.queue.counts.failed ?? '-'}</dd></div>
          </dl>
        </article>

        <article className="ops-card">
          <h3>{t('operations.spots')}</h3>
          <dl className="ops-key-values">
            <div><dt>{t('operations.spotsQueued')}</dt><dd>{opsOverview?.spots.counts.queued ?? '-'}</dd></div>
            <div><dt>{t('operations.spotsProcessing')}</dt><dd>{opsOverview?.spots.counts.processing ?? '-'}</dd></div>
            <div><dt>{t('operations.spotsCompleted')}</dt><dd>{opsOverview?.spots.counts.completed ?? '-'}</dd></div>
            <div><dt>{t('operations.spotsFailed')}</dt><dd>{opsOverview?.spots.counts.failed ?? '-'}</dd></div>
            {(opsOverview?.spots.unrecoverable ?? 0) > 0 && (
              <div><dt>{t('operations.spotsUnrecoverable')}</dt><dd>{opsOverview?.spots.unrecoverable}</dd></div>
            )}
          </dl>
        </article>

        <article className="ops-card">
          <h3>{t('operations.workerActivity')}</h3>
          <dl className="ops-timestamps">
            <div><dt>{t('operations.heartbeat')}</dt><dd>{formatTimestamp(opsOverview?.worker.lastHeartbeatAt ?? null)}</dd></div>
            <div><dt>{t('operations.started')}</dt><dd>{formatTimestamp(opsOverview?.worker.lastJobStartedAt ?? null)}</dd></div>
            <div><dt>{t('operations.completed')}</dt><dd>{formatTimestamp(opsOverview?.worker.lastJobCompletedAt ?? null)}</dd></div>
            <div><dt>{t('operations.failed')}</dt><dd>{formatTimestamp(opsOverview?.worker.lastJobFailedAt ?? null)}</dd></div>
          </dl>
        </article>
      </div>

      <div className="ops-age-grid">
        <div className="ops-age-card">
          <span>{t('operations.oldestQueuedSpot')}</span>
          <strong>{formatAge(opsOverview?.spots.oldestQueuedAgeSeconds ?? null)}</strong>
        </div>
        <div className="ops-age-card">
          <span>{t('operations.oldestProcessingSpot')}</span>
          <strong>{formatAge(opsOverview?.spots.oldestProcessingAgeSeconds ?? null)}</strong>
        </div>
      </div>
    </fieldset>
  )
}
