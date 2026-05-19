import { useEffect, useState } from 'react'
import { useAdminStore } from '../../stores/adminStore'
import { useVersionStore } from '../../stores/versionStore'
import { useConnectivityStore } from '../../stores/connectivityStore'
import { formatTimestamp } from '../../utils/formatTimestamp'
import { CountdownButton } from '../CountdownButton'
import { UMAMI_SHARE_URL } from '../../lib/analytics'

const REPO_URL = 'https://github.com/cleancentive/cleancentive'

function renderCommit(commit: string | undefined, commitShort: string | undefined) {
  if (!commit || !commitShort || commit === 'dev') {
    return commitShort ?? '-'
  }
  return (
    <a href={`${REPO_URL}/commit/${commit}`} target="_blank" rel="noopener noreferrer" title={commit}>
      {commitShort}
    </a>
  )
}

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
  const { isOnline } = useConnectivityStore()
  const opsOverview = useAdminStore((s) => s.opsOverview)
  const isLoadingOps = useAdminStore((s) => s.isLoadingOps)
  const isRetryingFailedSpots = useAdminStore((s) => s.isRetryingFailedSpots)
  const retryFailedSpotsResult = useAdminStore((s) => s.retryFailedSpotsResult)
  const fetchOpsOverview = useAdminStore((s) => s.fetchOpsOverview)
  const retryFailedSpots = useAdminStore((s) => s.retryFailedSpots)
  const { versionInfo, fetchVersionInfo } = useVersionStore()

  const [retryBatchSize, setRetryBatchSize] = useState('10')

  useEffect(() => {
    fetchOpsOverview()
    fetchVersionInfo()
  }, [fetchOpsOverview, fetchVersionInfo])

  const parsedRetryBatchSize = Number.parseInt(retryBatchSize, 10)
  const retryLimit = Number.isFinite(parsedRetryBatchSize) && parsedRetryBatchSize > 0 ? parsedRetryBatchSize : 10

  return (
    <fieldset className="page-card ops-overview-panel">
      <legend>Operations Overview</legend>
      <div className="ops-overview-header">
        <div>
          <p>
            {opsOverview
              ? `Updated ${new Date(opsOverview.timestamp).toLocaleTimeString()}`
              : 'Live processing status for stewards'}
            {UMAMI_SHARE_URL && (
              <>
                {' · '}
                <a href={UMAMI_SHARE_URL} target="_blank" rel="noopener noreferrer" className="ops-analytics-link">
                  Analytics ↗
                </a>
              </>
            )}
          </p>
        </div>
        <CountdownButton
          intervalSeconds={5}
          isLoading={isLoadingOps}
          disabled={!isOnline || isRetryingFailedSpots}
          onRefresh={fetchOpsOverview}
        />
      </div>

      {(opsOverview?.spots.counts.failed ?? 0) > 0 && (
        <div className="ops-actions-row">
          <label className="ops-batch-label">
            Retry batch size
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
            {isRetryingFailedSpots ? 'Retrying...' : 'Retry failed spots'}
          </button>
          {retryFailedSpotsResult && <p className="ops-retry-result">{retryFailedSpotsResult}</p>}
        </div>
      )}

      <div className="ops-metrics-grid">
        <article className="ops-card ops-card-status">
          <span className={`ops-status-pill ops-status-${opsOverview?.health.status || 'degraded'}`}>
            {opsOverview?.health.status || 'loading'}
          </span>
          <h3>System Health</h3>
          <p>
            Worker {opsOverview?.worker.healthy ? 'heartbeat is fresh' : 'heartbeat is stale'}
          </p>
        </article>

        <article className="ops-card">
          <h3>Queue</h3>
          <dl className="ops-key-values">
            <div><dt>Waiting</dt><dd>{opsOverview?.queue.counts.waiting ?? '-'}</dd></div>
            <div><dt>Active</dt><dd>{opsOverview?.queue.counts.active ?? '-'}</dd></div>
            <div><dt>Delayed</dt><dd>{opsOverview?.queue.counts.delayed ?? '-'}</dd></div>
            <div><dt>Failed</dt><dd>{opsOverview?.queue.counts.failed ?? '-'}</dd></div>
          </dl>
        </article>

        <article className="ops-card">
          <h3>Spots</h3>
          <dl className="ops-key-values">
            <div><dt>Queued</dt><dd>{opsOverview?.spots.counts.queued ?? '-'}</dd></div>
            <div><dt>Processing</dt><dd>{opsOverview?.spots.counts.processing ?? '-'}</dd></div>
            <div><dt>Completed</dt><dd>{opsOverview?.spots.counts.completed ?? '-'}</dd></div>
            <div><dt>Failed</dt><dd>{opsOverview?.spots.counts.failed ?? '-'}</dd></div>
          </dl>
        </article>

        <article className="ops-card">
          <h3>Worker Activity</h3>
          <dl className="ops-timestamps">
            <div><dt>Heartbeat</dt><dd>{formatTimestamp(opsOverview?.worker.lastHeartbeatAt ?? null)}</dd></div>
            <div><dt>Started</dt><dd>{formatTimestamp(opsOverview?.worker.lastJobStartedAt ?? null)}</dd></div>
            <div><dt>Completed</dt><dd>{formatTimestamp(opsOverview?.worker.lastJobCompletedAt ?? null)}</dd></div>
            <div><dt>Failed</dt><dd>{formatTimestamp(opsOverview?.worker.lastJobFailedAt ?? null)}</dd></div>
          </dl>
        </article>
      </div>

      <div className="ops-age-grid">
        <div className="ops-age-card">
          <span>Oldest queued spot</span>
          <strong>{formatAge(opsOverview?.spots.oldestQueuedAgeSeconds ?? null)}</strong>
        </div>
        <div className="ops-age-card">
          <span>Oldest processing spot</span>
          <strong>{formatAge(opsOverview?.spots.oldestProcessingAgeSeconds ?? null)}</strong>
        </div>
      </div>

      <h3>Deployed Versions</h3>
      <table className="ops-version-table">
        <thead>
          <tr>
            <th>Artifact</th>
            <th>Version</th>
            <th>Built</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Backend</td>
            <td className="ops-version-hash">{renderCommit(versionInfo?.backend?.commit, versionInfo?.backend?.commitShort)}</td>
            <td>{versionInfo?.backend.buildTime ? formatTimestamp(new Date(versionInfo.backend.buildTime * 1000).toISOString()) : '-'}</td>
          </tr>
          <tr>
            <td>Frontend</td>
            <td className="ops-version-hash">{renderCommit(__APP_COMMIT__, __APP_COMMIT_SHORT__)}</td>
            <td>{__APP_BUILD_TIME__ ? formatTimestamp(new Date(__APP_BUILD_TIME__ * 1000).toISOString()) : '-'}</td>
          </tr>
          <tr>
            <td>Worker</td>
            <td className="ops-version-hash">{renderCommit(versionInfo?.worker?.commit, versionInfo?.worker?.commitShort)}</td>
            <td>{versionInfo?.worker?.buildTime ? formatTimestamp(new Date(versionInfo.worker.buildTime * 1000).toISOString()) : '-'}</td>
          </tr>
        </tbody>
      </table>
    </fieldset>
  )
}
