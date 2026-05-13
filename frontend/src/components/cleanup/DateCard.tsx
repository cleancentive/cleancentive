import { API_BASE } from '../../lib/apiBase'
import { formatDateRange } from '../../utils/datetime'

export interface CleanupDateForCard {
  id: string
  start_at: string
  end_at: string
  latitude: number
  longitude: number
  location_name: string | null
  recurrence_id: string | null
}

interface DateCardProps {
  date: CleanupDateForCard
  isOrganizer: boolean
  isParticipant: boolean
  isSelected: boolean
  ongoing: boolean
  isActive: boolean
  borderColor: string | undefined
  isGlowing: boolean
  isOnline: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onDoubleClick: () => void
  onToggleSelect: () => void
  onActivate: () => void
  onDeactivate: () => void
  onEdit: () => void
  onDelete: () => void
}

export function DateCard({
  date,
  isOrganizer,
  isParticipant,
  isSelected,
  ongoing,
  isActive,
  borderColor,
  isGlowing,
  isOnline,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
  onToggleSelect,
  onActivate,
  onDeactivate,
  onEdit,
  onDelete,
}: DateCardProps) {
  return (
    <div
      className={`cleanup-date-card ${ongoing ? 'cleanup-date-card--ongoing' : ''} ${isSelected ? 'cleanup-date-card--selected' : ''} ${isGlowing ? 'cleanup-date-card--glow' : ''}`}
      style={{
        borderLeftWidth: borderColor ? '4px' : undefined,
        borderLeftColor: borderColor,
        '--recurrence-color': borderColor || 'transparent',
      } as React.CSSProperties}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDoubleClick={onDoubleClick}
    >
      {isOrganizer && (
        <input
          type="checkbox"
          className="date-select-checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
        />
      )}
      <div className="cleanup-date-info">
        <strong>{formatDateRange(date.start_at, date.end_at)}</strong>
        {date.location_name && <span className="cleanup-date-location"> · {date.location_name}</span>}
        {ongoing && <span className="badge" style={{ marginLeft: '0.5rem' }}>Ongoing</span>}
        {isActive && <span className="badge admin-badge" style={{ marginLeft: '0.25rem' }}>Active</span>}
      </div>
      <div className="cleanup-date-actions">
        {isParticipant && ongoing && !isActive && (
          <button className="secondary-button" onClick={onActivate} disabled={!isOnline}>
            Activate
          </button>
        )}
        {isParticipant && isActive && (
          <button className="secondary-button" onClick={onDeactivate} disabled={!isOnline}>
            Deactivate
          </button>
        )}
        <a
          className="link-button"
          href={`${API_BASE}/calendar/cleanup-dates/${date.id}.ics`}
          title="Download .ics for this date"
        >
          Add to calendar
        </a>
        {isOrganizer && (
          <>
            <button className="link-button" onClick={onEdit}>Edit</button>
            <button className="link-button danger-text" onClick={onDelete}>Delete</button>
          </>
        )}
      </div>
    </div>
  )
}
