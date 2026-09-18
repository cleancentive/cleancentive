import type { CleanupSearchResult } from '../stores/cleanupStore'

/**
 * Splits a team's cleanups into what is still to come and what already happened.
 * Upcoming runs soonest-first (that is the one people need), past runs most
 * recent first. Cleanups without a date sort last — they are unscheduled drafts.
 */
export function partitionTeamCleanups(
  items: CleanupSearchResult[],
  now: number = Date.now(),
): { upcoming: CleanupSearchResult[]; past: CleanupSearchResult[] } {
  const upcoming: CleanupSearchResult[] = []
  const past: CleanupSearchResult[] = []

  for (const item of items) {
    if (item.nearestDate && new Date(item.nearestDate.end_at).getTime() >= now) {
      upcoming.push(item)
    } else {
      past.push(item)
    }
  }

  upcoming.sort((a, b) => startTime(a) - startTime(b))
  past.sort((a, b) => startTime(b) - startTime(a))

  return { upcoming, past }
}

function startTime(item: CleanupSearchResult): number {
  return item.nearestDate ? new Date(item.nearestDate.start_at).getTime() : Number.NEGATIVE_INFINITY
}
