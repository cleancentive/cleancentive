export const FEEDBACK_STATUSES = ['new', 'acknowledged', 'in_progress', 'resolved'] as const

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

// "anything but closed" — resolved is the terminal/closed state and is hidden by default.
export const DEFAULT_FEEDBACK_STATUS_FILTER = ['new', 'acknowledged', 'in_progress'] as const

export function parseFeedbackStatusFilter(searchParams: URLSearchParams): Set<string> {
  // No status param at all → apply the default filter (redirect, bare links, old bookmarks).
  if (!searchParams.has('status')) {
    return new Set(DEFAULT_FEEDBACK_STATUS_FILTER)
  }

  // Present (possibly empty) → exactly the selected statuses. An empty set means "show all",
  // preserving the backend's size === 0 behavior.
  const raw = searchParams.get('status') ?? ''
  const selected = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is FeedbackStatus => (FEEDBACK_STATUSES as readonly string[]).includes(s))
  return new Set(selected)
}

export function serializeFeedbackStatusFilter(filter: Set<string>): URLSearchParams {
  const params = new URLSearchParams()
  // Always write the param (in canonical order) so the URL is self-describing and an empty
  // selection is distinguishable from "no param" (default).
  const ordered = FEEDBACK_STATUSES.filter((s) => filter.has(s))
  params.set('status', ordered.join(','))
  return params
}
