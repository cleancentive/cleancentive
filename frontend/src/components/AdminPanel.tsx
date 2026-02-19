import { useEffect, useRef, useCallback, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAdminStore } from '../stores/adminStore'
import { useAuthStore } from '../stores/authStore'

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
    hasMore,
    error,
    checkAdminStatus,
    fetchUsers,
    setSort,
    setOrder,
    setSearch,
    clearError,
  } = useAdminStore()

  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    checkAdminStatus().then(() => setChecked(true))
  }, [checkAdminStatus])

  useEffect(() => {
    if (checked && isAdmin) {
      fetchUsers()
    }
  }, [checked, isAdmin, fetchUsers])

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

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <h1>Admin Panel</h1>
        <Link to="/" className="back-link">Back to Dashboard</Link>
      </header>

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
