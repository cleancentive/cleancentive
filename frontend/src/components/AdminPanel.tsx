import { useEffect, useRef, useCallback, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAdminStore } from '../stores/adminStore'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { formatTimestamp } from '../utils/formatTimestamp'
import { CountdownButton } from './CountdownButton'
import { UMAMI_SHARE_URL } from '../lib/analytics'
import { Avatar } from './Avatar'

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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function AdminPanel() {
  const { feedbackId: feedbackIdParam } = useParams<{ feedbackId?: string }>()
  const { user } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const {
    isAdmin,
    users,
    total,
    sort,
    order,
    search,
    isLoading,
    isLoadingOps,
    isRetryingFailedSpots,
    hasMore,
    error,
    opsOverview,
    storageInsights,
    purgeStatus,
    retryFailedSpotsResult,
    checkAdminStatus,
    fetchUsers,
    fetchOpsOverview,
    fetchStorageInsights,
    fetchPurgeStatus,
    retryFailedSpots,
    setSort,
    setOrder,
    setSearch,
    clearError,
    feedbackItems,
    feedbackTotal,
    feedbackStatusFilter,
    isLoadingFeedback,
    activeFeedbackItem,
    fetchFeedback,
    fetchFeedbackDetail,
    updateFeedbackStatus,
    addAdminResponse,
    setFeedbackStatusFilter,
    versionInfo,
    fetchVersionInfo,
  } = useAdminStore()

  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [checked, setChecked] = useState(false)
  const [retryBatchSize, setRetryBatchSize] = useState('10')
  const [expandedFeedbackId, setExpandedFeedbackId] = useState<string | null>(null)
  const [adminReply, setAdminReply] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('')

  useEffect(() => {
    checkAdminStatus().then(() => setChecked(true))
  }, [checkAdminStatus])

  useEffect(() => {
    if (checked && isAdmin) {
      fetchUsers()
      fetchOpsOverview()
      fetchStorageInsights()
      fetchPurgeStatus()
      fetchFeedback()
      fetchVersionInfo()
    }
  }, [checked, isAdmin, fetchUsers, fetchOpsOverview, fetchStorageInsights, fetchPurgeStatus, fetchVersionInfo])

  // Deep-link to a specific feedback item via /steward/feedback/:feedbackId
  useEffect(() => {
    if (checked && isAdmin && feedbackIdParam) {
      setFeedbackStatusFilter('')
      fetchFeedbackDetail(feedbackIdParam).then(() => {
        setExpandedFeedbackId(feedbackIdParam)
      })
    }
  }, [checked, isAdmin, feedbackIdParam, fetchFeedbackDetail, setFeedbackStatusFilter])

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(value)
    }, 300)
  }

  // Infinite scroll via IntersectionObserver
  const observerCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && !isLoading && hasMore) {
        fetchUsers(true)
      }
    },
    [isLoading, hasMore, fetchUsers],
  )

  useEffect(() => {
    const observer = new IntersectionObserver(observerCallback, { threshold: 0.1 })
    const sentinel = sentinelRef.current
    if (sentinel) observer.observe(sentinel)
    return () => {
      if (sentinel) observer.unobserve(sentinel)
    }
  }, [observerCallback])

  if (!user) {
    return <Navigate to="/" replace />
  }

  if (!checked) {
    return <div className="admin-panel"><p className="loading">Loading...</p></div>
  }

  if (!isAdmin) {
    return (
      <div className="admin-panel">
        <div className="access-denied">
          <h2>Access Denied</h2>
          <p>You do not have steward privileges.</p>
          <Link to="/">Go Home</Link>
        </div>
      </div>
    )
  }

  const parsedRetryBatchSize = Number.parseInt(retryBatchSize, 10)
  const retryLimit = Number.isFinite(parsedRetryBatchSize) && parsedRetryBatchSize > 0 ? parsedRetryBatchSize : 10

  return (
    <div className="admin-panel">
      <fieldset className="page-card ops-overview-panel">
        <legend>Operations Overview</legend>
        <div className="ops-overview-header">
          <div>
            <p>
              {opsOverview
                ? `Updated ${new Date(opsOverview.timestamp).toLocaleTimeString()}`
                : 'Live processing status for stewards'}
            </p>
          </div>
          <CountdownButton
            intervalSeconds={5}
            isLoading={isLoadingOps}
            disabled={!isOnline || isRetryingFailedSpots}
            onRefresh={fetchOpsOverview}
          />
          {UMAMI_SHARE_URL && (
            <a href={UMAMI_SHARE_URL} target="_blank" rel="noopener noreferrer" className="ops-analytics-link">
              Analytics ↗
            </a>
          )}
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
              <td className="ops-version-hash">{versionInfo?.backend.version ?? '-'}</td>
              <td>{versionInfo?.backend.buildTime ? formatTimestamp(new Date(versionInfo.backend.buildTime * 1000).toISOString()) : '-'}</td>
            </tr>
            <tr>
              <td>Frontend</td>
              <td className="ops-version-hash">{__APP_VERSION__}</td>
              <td>{__APP_BUILD_TIME__ ? formatTimestamp(new Date(__APP_BUILD_TIME__ * 1000).toISOString()) : '-'}</td>
            </tr>
            <tr>
              <td>Worker</td>
              <td className="ops-version-hash">{versionInfo?.worker?.version ?? '-'}</td>
              <td>{versionInfo?.worker?.buildTime ? formatTimestamp(new Date(versionInfo.worker.buildTime * 1000).toISOString()) : '-'}</td>
            </tr>
          </tbody>
        </table>
      </fieldset>

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

      <fieldset className="page-card user-admin-panel">
        <legend>Users</legend>
        <div className="user-admin-header">
          <div>
            <p>{total} total</p>
          </div>
        </div>

        <div className="admin-controls">
          <input
            type="text"
            placeholder="Search users by name or email..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="search-input"
          />

          <div className="sort-controls">
            <label>
              Sort by:
              <select value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="created_at">Created</option>
                <option value="last_login">Last Login</option>
              </select>
            </label>

            <label>
              Order:
              <select value={order} onChange={(e) => setOrder(e.target.value as any)}>
                <option value="DESC">Newest First</option>
                <option value="ASC">Oldest First</option>
              </select>
            </label>
          </div>
        </div>

        {error && (
          <div className="error-message">
            {error}
            <button onClick={clearError}>&times;</button>
          </div>
        )}

        <div className="user-list">
          {users.map((u) => (
            <Link key={u.id} to={`/steward/users/${u.id}`} className="user-card">
              <div className="user-info">
                <h3>
                  {u.nickname}
                  {u.is_admin && <span className="badge admin-badge">Admin</span>}
                </h3>
                {u.full_name && <p className="full-name">{u.full_name}</p>}
                <div className="user-emails">
                  {u.emails.map(email => (
                    <span key={email.id} className="email-badge">{email.email}</span>
                  ))}
                </div>
                <div className="user-meta">
                  <span>Created: {new Date(u.created_at).toLocaleDateString()}</span>
                  {u.last_login && (
                    <span>Last Login: {new Date(u.last_login).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
              <Avatar userId={u.id} avatarEmailId={u.avatar_email_id} nickname={u.nickname} size={36} />
              <span className="view-details">View Details &rarr;</span>
            </Link>
          ))}

          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} className="scroll-sentinel" />

          {isLoading && <p className="loading">Loading...</p>}
          {!isLoading && !hasMore && users.length > 0 && (
            <p className="end-of-list">All users loaded</p>
          )}
        </div>
      </fieldset>
      <fieldset className="page-card">
        <legend>Feedback ({feedbackTotal})</legend>
        <div className="feedback-admin-filters">
          {['', 'new', 'acknowledged', 'in_progress', 'resolved'].map((s) => (
            <button
              key={s}
              className={`filter-tab${feedbackStatusFilter === s ? ' filter-tab--active' : ''}`}
              onClick={() => setFeedbackStatusFilter(s)}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        {isLoadingFeedback && <p className="loading">Loading...</p>}

        {!isLoadingFeedback && feedbackItems.length === 0 && (
          <p className="end-of-list">No feedback found.</p>
        )}

        <div className="feedback-admin-list">
          {feedbackItems.map((f) => (
            <div key={f.id} className="feedback-admin-item">
              <div
                className="feedback-admin-item-header"
                onClick={async () => {
                  if (expandedFeedbackId === f.id) {
                    setExpandedFeedbackId(null)
                  } else {
                    await fetchFeedbackDetail(f.id)
                    setExpandedFeedbackId(f.id)
                    setFeedbackStatus(f.status)
                    setAdminReply('')
                  }
                }}
              >
                <span className="badge">{f.category}</span>
                <span className="badge" style={{ backgroundColor: f.status === 'resolved' ? '#22c55e' : f.status === 'in_progress' ? '#f59e0b' : f.status === 'acknowledged' ? '#3b82f6' : '#888', color: '#fff' }}>
                  {f.status.replace('_', ' ')}
                </span>
                <span className="feedback-admin-description">{f.description.slice(0, 80)}{f.description.length > 80 ? '...' : ''}</span>
                <span className="feedback-admin-meta">
                  {f.user_id
                    ? <Link to={`/steward/users/${f.user_id}`} onClick={(e) => e.stopPropagation()}>{f.submitter_nickname || 'Anonymous'}</Link>
                    : (f.submitter_nickname || 'Anonymous')
                  } &middot; {formatTimestamp(f.created_at)}
                  {f.responses.length > 0 && ` \u00b7 ${f.responses.length} response${f.responses.length !== 1 ? 's' : ''}`}
                </span>
                <Link to={`/steward/feedback/${f.id}`} className="feedback-permalink" onClick={(e) => e.stopPropagation()} title="Permalink">🔗</Link>
              </div>

              {expandedFeedbackId === f.id && activeFeedbackItem && (
                <div className="feedback-admin-detail">
                  <p className="feedback-detail-description">{activeFeedbackItem.description}</p>

                  {activeFeedbackItem.error_context && (
                    <details>
                      <summary>Error context</summary>
                      <pre className="feedback-error-details">{JSON.stringify(activeFeedbackItem.error_context, null, 2)}</pre>
                    </details>
                  )}

                  {activeFeedbackItem.contact_email && (
                    <p><strong>Contact:</strong> {activeFeedbackItem.contact_email}</p>
                  )}

                  <div className="feedback-thread">
                    {activeFeedbackItem.responses.map((r) => (
                      <div key={r.id} className={`feedback-thread-message ${r.is_from_steward ? 'feedback-thread-message--steward' : 'feedback-thread-message--user'}`}>
                        <div className="feedback-thread-header">
                          <strong>
                            {r.is_from_steward
                              ? <>{r.created_by ? <Link to={`/steward/users/${r.created_by}`}>{r.author_nickname || 'Steward'}</Link> : (r.author_nickname || 'Steward')} <span className="badge steward-badge">Steward</span></>
                              : activeFeedbackItem.user_id ? <Link to={`/steward/users/${activeFeedbackItem.user_id}`}>{activeFeedbackItem.submitter_nickname || 'User'}</Link> : (activeFeedbackItem.submitter_nickname || 'User')
                            }
                          </strong>
                          <span className="feedback-thread-date">{formatTimestamp(r.created_at)}</span>
                        </div>
                        <p>{r.message}</p>
                      </div>
                    ))}
                  </div>

                  <div className="feedback-admin-actions">
                    <label>
                      Status:
                      <select value={feedbackStatus} onChange={(e) => setFeedbackStatus(e.target.value)}>
                        <option value="new">New</option>
                        <option value="acknowledged">Acknowledged</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </label>
                    <button
                      className="primary-button"
                      onClick={() => updateFeedbackStatus(f.id, feedbackStatus)}
                      disabled={feedbackStatus === f.status}
                    >
                      Update Status
                    </button>
                  </div>

                  <form
                    className="feedback-reply-form"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (!adminReply.trim()) return
                      await addAdminResponse(f.id, adminReply.trim())
                      setAdminReply('')
                    }}
                  >
                    <textarea
                      value={adminReply}
                      onChange={(e) => setAdminReply(e.target.value)}
                      placeholder="Reply to this feedback..."
                      rows={2}
                    />
                    <button type="submit" className="primary-button" disabled={!adminReply.trim()}>
                      Send Reply
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
