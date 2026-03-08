import { useEffect, useRef, useCallback, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAdminStore } from '../stores/adminStore'
import { useAuthStore } from '../stores/authStore'

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

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'n/a'
  }

  return new Date(value).toLocaleString()
}

export function AdminPanel() {
  const { user } = useAuthStore()
  const {
    isAdmin,
    users,
    total,
    sort,
    order,
    search,
    isLoading,
    isLoadingOps,
    isRetryingFailedReports,
    hasMore,
    error,
    opsOverview,
    retryFailedReportsResult,
    checkAdminStatus,
    fetchUsers,
    fetchOpsOverview,
    retryFailedReports,
    setSort,
    setOrder,
    setSearch,
    clearError,
  } = useAdminStore()

  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [checked, setChecked] = useState(false)
  const [retryBatchSize, setRetryBatchSize] = useState('10')

  useEffect(() => {
    checkAdminStatus().then(() => setChecked(true))
  }, [checkAdminStatus])

  useEffect(() => {
    if (checked && isAdmin) {
      fetchUsers()
      fetchOpsOverview()
    }
  }, [checked, isAdmin, fetchUsers, fetchOpsOverview])

  useEffect(() => {
    if (!checked || !isAdmin) {
      return
    }

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        fetchOpsOverview()
      }
    }

    const interval = window.setInterval(refresh, 5000)
    document.addEventListener('visibilitychange', refresh)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [checked, isAdmin, fetchOpsOverview])

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
          <p>You do not have admin privileges.</p>
          <Link to="/">Go Home</Link>
        </div>
      </div>
    )
  }

  const parsedRetryBatchSize = Number.parseInt(retryBatchSize, 10)
  const retryLimit = Number.isFinite(parsedRetryBatchSize) && parsedRetryBatchSize > 0 ? parsedRetryBatchSize : 10

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <h1>Admin Panel</h1>
        <Link to="/" className="back-link">Back to Dashboard</Link>
      </header>

      <section className="ops-overview-panel">
        <div className="ops-overview-header">
          <div>
            <h2>Operations Overview</h2>
            <p>
              {opsOverview
                ? `Updated ${new Date(opsOverview.timestamp).toLocaleTimeString()}`
                : 'Live processing status for admins'}
            </p>
          </div>
          <button
            type="button"
            className="ops-refresh-button"
            onClick={() => fetchOpsOverview()}
            disabled={isLoadingOps || isRetryingFailedReports}
          >
            {isLoadingOps ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

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
            onClick={() => retryFailedReports(retryLimit)}
            disabled={isRetryingFailedReports || isLoadingOps || (opsOverview?.reports.counts.failed ?? 0) === 0}
          >
            {isRetryingFailedReports ? 'Retrying...' : 'Retry failed jobs'}
          </button>
          {retryFailedReportsResult && <p className="ops-retry-result">{retryFailedReportsResult}</p>}
        </div>

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
            <h3>Reports</h3>
            <dl className="ops-key-values">
              <div><dt>Queued</dt><dd>{opsOverview?.reports.counts.queued ?? '-'}</dd></div>
              <div><dt>Processing</dt><dd>{opsOverview?.reports.counts.processing ?? '-'}</dd></div>
              <div><dt>Completed</dt><dd>{opsOverview?.reports.counts.completed ?? '-'}</dd></div>
              <div><dt>Failed</dt><dd>{opsOverview?.reports.counts.failed ?? '-'}</dd></div>
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
            <span>Oldest queued report</span>
            <strong>{formatAge(opsOverview?.reports.oldestQueuedAgeSeconds ?? null)}</strong>
          </div>
          <div className="ops-age-card">
            <span>Oldest processing report</span>
            <strong>{formatAge(opsOverview?.reports.oldestProcessingAgeSeconds ?? null)}</strong>
          </div>
        </div>
      </section>

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

      <div className="user-list-header">
        <p>Total Users: {total}</p>
      </div>

      <div className="user-list">
        {users.map((u) => (
          <Link key={u.id} to={`/admin/users/${u.id}`} className="user-card">
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
    </div>
  )
}
