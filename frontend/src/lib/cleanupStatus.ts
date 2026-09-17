export type CleanupStatus = 'past' | 'ongoing' | 'future'

export type CleanupCounts = { past: number; ongoing: number; future: number }

/**
 * The list opens on ongoing+future. When a community has nothing scheduled that
 * reads as "No cleanups found" even though the pills say Past (13), so widen to
 * past once — only when past is the sole place anything lives.
 */
export function shouldFallBackToPast(
  statuses: Set<CleanupStatus>,
  counts: CleanupCounts | null,
  itemCount: number,
): boolean {
  if (itemCount > 0) return false
  if (!counts) return false
  if (counts.ongoing > 0 || counts.future > 0) return false
  if (counts.past === 0) return false
  return !statuses.has('past')
}
