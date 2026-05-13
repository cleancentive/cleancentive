import { formatShortDate } from '../../utils/datetime'

interface BulkDateActionsProps {
  selectedCount: number
  earliestSelectedStartAt: string | null
  hasSelectedWithRecurrence: boolean
  isOnline: boolean
  onSelectRelated: () => void
  onSelectAllAfter: () => void
  onRequestBulkDelete: () => void
  onClearSelection: () => void
}

export function BulkDateActions({
  selectedCount,
  earliestSelectedStartAt,
  hasSelectedWithRecurrence,
  isOnline,
  onSelectRelated,
  onSelectAllAfter,
  onRequestBulkDelete,
  onClearSelection,
}: BulkDateActionsProps) {
  return (
    <div className="bulk-actions">
      {hasSelectedWithRecurrence && (
        <button className="secondary-button" onClick={onSelectRelated}>Select related dates</button>
      )}
      {earliestSelectedStartAt && (
        <button className="secondary-button" onClick={onSelectAllAfter}>
          Select all after {formatShortDate(earliestSelectedStartAt)}
        </button>
      )}
      <button className="danger-button" onClick={onRequestBulkDelete} disabled={!isOnline}>
        Delete {selectedCount} date{selectedCount > 1 ? 's' : ''}
      </button>
      <button className="link-button" onClick={onClearSelection}>Clear selection</button>
    </div>
  )
}
