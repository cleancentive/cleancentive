import { useEffect, useRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAdminStore } from '../../stores/adminStore'
import { Avatar } from '../Avatar'

export function StewardUsers() {
  const { t } = useTranslation(['steward', 'common'])
  const users = useAdminStore((s) => s.users)
  const total = useAdminStore((s) => s.total)
  const sort = useAdminStore((s) => s.sort)
  const order = useAdminStore((s) => s.order)
  const search = useAdminStore((s) => s.search)
  const isLoading = useAdminStore((s) => s.isLoading)
  const hasMore = useAdminStore((s) => s.hasMore)
  const error = useAdminStore((s) => s.error)
  const fetchUsers = useAdminStore((s) => s.fetchUsers)
  const setSort = useAdminStore((s) => s.setSort)
  const setOrder = useAdminStore((s) => s.setOrder)
  const setSearch = useAdminStore((s) => s.setSearch)
  const clearError = useAdminStore((s) => s.clearError)

  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(value)
    }, 300)
  }

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

  return (
    <fieldset className="page-card user-admin-panel">
      <legend>{t('users.legend')}</legend>
      <div className="user-admin-header">
        <div>
          <p>{t('users.total', { count: total })}</p>
        </div>
      </div>

      <div className="admin-controls">
        <input
          type="text"
          placeholder={t('users.searchPlaceholder')}
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="search-input"
        />

        <div className="sort-controls">
          <label>
            {t('users.sortBy')}
            <select value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="created_at">{t('users.sortCreated')}</option>
              <option value="last_login">{t('users.sortLastLogin')}</option>
            </select>
          </label>

          <label>
            {t('users.order')}
            <select value={order} onChange={(e) => setOrder(e.target.value as any)}>
              <option value="DESC">{t('users.orderNewest')}</option>
              <option value="ASC">{t('users.orderOldest')}</option>
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
                {u.is_admin && <span className="badge admin-badge">{t('users.adminBadge')}</span>}
              </h3>
              {u.full_name && <p className="full-name">{u.full_name}</p>}
              <div className="user-emails">
                {u.emails.map(email => (
                  <span key={email.id} className="email-badge">{email.email}</span>
                ))}
              </div>
              <div className="user-meta">
                <span>{t('users.createdLabel', { date: new Date(u.created_at).toLocaleDateString() })}</span>
                {u.last_login && (
                  <span>{t('users.lastLoginLabel', { date: new Date(u.last_login).toLocaleDateString() })}</span>
                )}
              </div>
            </div>
            <Avatar userId={u.id} avatarEmailId={u.avatar_email_id} nickname={u.nickname} size={36} />
            <span className="view-details">{t('users.viewDetails')}</span>
          </Link>
        ))}

        <div ref={sentinelRef} className="scroll-sentinel" />

        {isLoading && <p className="loading">{t('users.loading')}</p>}
        {!isLoading && !hasMore && users.length > 0 && (
          <p className="end-of-list">{t('users.allLoaded')}</p>
        )}
      </div>
    </fieldset>
  )
}
