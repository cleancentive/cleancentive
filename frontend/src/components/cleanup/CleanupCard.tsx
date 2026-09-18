import { useTranslation } from 'react-i18next'
import { CommunityCard } from '../CommunityCard'
import { markdownPreview } from '../../lib/markdownPreview'
import type { CleanupSearchResult } from '../../stores/cleanupStore'

interface CleanupCardProps {
  item: CleanupSearchResult
  activeCleanupDateId: string | null
  /** Off on the team's own page, where every card would carry the same badge. */
  showTeam?: boolean
}

function formatDateRange(startAt: string, endAt: string): string {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  if (start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString(undefined, opts)
  }
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`
}

export function CleanupCard({ item, activeCleanupDateId, showTeam = true }: CleanupCardProps) {
  const { t } = useTranslation(['cleanups', 'common'])
  const { cleanup, nearestDate, userRole } = item
  const isActive = nearestDate && activeCleanupDateId === nearestDate.id
  const team = showTeam ? cleanup.team ?? item.team : null

  return (
    <CommunityCard
      to={`/cleanups/${cleanup.id}`}
      title={cleanup.name}
      description={markdownPreview(cleanup.description)}
      tags={
        <>
          {userRole && <span className={`badge ${userRole === 'admin' ? 'admin-badge' : ''}`}>{userRole === 'organizer' ? t('common:domain.organizer') : userRole === 'member' ? t('cleanups:members.roleMember') : userRole}</span>}
          {isActive && <span className="badge" style={{ background: 'var(--color-badge-active)' }}>{t('cleanups:list.badge.active')}</span>}
          {team && (
            <span className="badge" style={{ background: 'var(--color-badge-partner)' }} title={t('cleanups:card.organizedBy', { team: team.name })}>
              {team.name}
            </span>
          )}
        </>
      }
      meta={nearestDate && (
        <>
          <span>{formatDateRange(nearestDate.start_at, nearestDate.end_at)}</span>
          {nearestDate.location_name && <span> · {nearestDate.location_name}</span>}
        </>
      )}
    />
  )
}
