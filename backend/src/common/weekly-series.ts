const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

export const DEFAULT_SERIES_WEEKS = 12;
const MAX_SERIES_WEEKS = 52;

/**
 * The week-start keys a weekly series must contain, oldest first, ending with
 * the week that contains `now`.
 *
 * These keys have to line up exactly with what Postgres returns for
 * `TO_CHAR(date_trunc('week', …), 'YYYY-MM-DD')`, so weeks are Monday-based
 * (ISO) and computed in UTC — the database containers set no TZ, so they run
 * UTC too. Sparse query results are merged onto this list so a week with no
 * rows renders as a zero bar instead of vanishing and shifting the chart.
 */
export function listWeekStarts(weeks: number, now: Date = new Date()): string[] {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const currentWeekStart =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysSinceMonday * MS_PER_DAY;

  const starts: string[] = [];
  for (let weeksAgo = weeks - 1; weeksAgo >= 0; weeksAgo--) {
    const start = currentWeekStart - weeksAgo * DAYS_PER_WEEK * MS_PER_DAY;
    starts.push(new Date(start).toISOString().slice(0, 10));
  }
  return starts;
}

/** Read a `?weeks=` query param, falling back to 12 and capping at a year. */
export function parseWeeksParam(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SERIES_WEEKS;
  }
  return Math.min(parsed, MAX_SERIES_WEEKS);
}
