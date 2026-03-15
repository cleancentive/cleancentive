import { useState, useRef, type ReactNode } from 'react'

interface CommunityListProps {
  title: string
  searchPlaceholder: string
  onSearchChange: (query: string) => void
  isLoading: boolean
  error: string | null
  onClearError: () => void
  emptyMessage: string
  isEmpty: boolean
  actions?: ReactNode
  filters?: ReactNode
  hideSearch?: boolean
  children: ReactNode
}

export function CommunityList({
  title,
  searchPlaceholder,
  onSearchChange,
  isLoading,
  error,
  onClearError,
  emptyMessage,
  isEmpty,
  actions,
  filters,
  hideSearch,
  children,
}: CommunityListProps) {
  const [searchInput, setSearchInput] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearchChange(value)
    }, 300)
  }

  return (
    <div className="community-list">
      <fieldset className="page-card">
        <legend>{title}</legend>

        <div className="community-list-header">
          {!hideSearch && (
            <input
              type="search"
              placeholder={searchPlaceholder}
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="search-input"
            />
          )}
          {actions}
        </div>

        {!hideSearch && filters && <div className="community-list-filters">{filters}</div>}

        {error && (
          <div className="error-message">
            {error}
            <button onClick={onClearError}>&times;</button>
          </div>
        )}

        <div className="community-list-items">
          {children}
          {isLoading && <p className="loading">Loading...</p>}
          {!isLoading && isEmpty && <p className="end-of-list">{emptyMessage}</p>}
        </div>
      </fieldset>
    </div>
  )
}
