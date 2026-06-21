import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation(['cleanups'])
  return (
    <div className="bulk-actions">
      {hasSelectedWithRecurrence && (
        <button className="secondary-button" onClick={onSelectRelated}>{t('cleanups:bulk.selectRelated')}</button>
      )}
      {earliestSelectedStartAt && (
        <button className="secondary-button" onClick={onSelectAllAfter}>
          {t('cleanups:bulk.selectAllAfter', { date: formatShortDate(earliestSelectedStartAt) })}
        </button>
      )}
      <button className="danger-button" onClick={onRequestBulkDelete} disabled={!isOnline}>
        {t('cleanups:bulk.delete', { count: selectedCount })}
      </button>
      <button className="link-button" onClick={onClearSelection}>{t('cleanups:bulk.clearSelection')}</button>
    </div>
  )
}
