import { describe, expect, test } from 'bun:test'
import { partitionTeamCleanups } from './teamCleanups'
import type { CleanupSearchResult } from '../stores/cleanupStore'

const NOW = new Date('2026-06-15T12:00:00.000Z').getTime()

function item(id: string, startAt: string | null, endAt?: string): CleanupSearchResult {
  return {
    cleanup: { id, name: id, description: '', created_at: '2026-01-01T00:00:00.000Z' },
    nearestDate: startAt
      ? {
          id: `${id}-d`,
          start_at: startAt,
          end_at: endAt ?? startAt,
          latitude: 47,
          longitude: 8,
          location_name: null,
          recurrence_id: null,
        }
      : null,
    dates: [],
    userRole: null,
  }
}

describe('partitionTeamCleanups', () => {
  test('upcoming comes soonest-first, past most-recent-first', () => {
    const { upcoming, past } = partitionTeamCleanups(
      [
        item('far', '2026-09-01T08:00:00.000Z', '2026-09-01T15:00:00.000Z'),
        item('old', '2026-01-10T08:00:00.000Z', '2026-01-10T15:00:00.000Z'),
        item('soon', '2026-06-20T08:00:00.000Z', '2026-06-20T15:00:00.000Z'),
        item('recent', '2026-05-02T08:00:00.000Z', '2026-05-02T15:00:00.000Z'),
      ],
      NOW,
    )

    expect(upcoming.map((i) => i.cleanup.id)).toEqual(['soon', 'far'])
    expect(past.map((i) => i.cleanup.id)).toEqual(['recent', 'old'])
  })

  test('a cleanup running right now counts as upcoming', () => {
    const { upcoming } = partitionTeamCleanups(
      [item('ongoing', '2026-06-15T08:00:00.000Z', '2026-06-15T16:00:00.000Z')],
      NOW,
    )
    expect(upcoming.map((i) => i.cleanup.id)).toEqual(['ongoing'])
  })

  test('the end of the window is still upcoming, a second later is past', () => {
    const exactly = partitionTeamCleanups([item('edge', '2026-06-15T08:00:00.000Z', '2026-06-15T12:00:00.000Z')], NOW)
    expect(exactly.upcoming).toHaveLength(1)

    const justOver = partitionTeamCleanups([item('edge', '2026-06-15T08:00:00.000Z', '2026-06-15T11:59:59.000Z')], NOW)
    expect(justOver.past).toHaveLength(1)
  })

  test('cleanups without a date sort last among past', () => {
    const { past } = partitionTeamCleanups(
      [item('undated', null), item('dated', '2026-05-02T08:00:00.000Z', '2026-05-02T15:00:00.000Z')],
      NOW,
    )
    expect(past.map((i) => i.cleanup.id)).toEqual(['dated', 'undated'])
  })
})
