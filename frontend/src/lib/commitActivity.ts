export interface WeeklyCount {
  week: string
  count: number
}

interface GitHubCommitActivityWeek {
  week: number
  total: number
}

// GitHub computes these stats lazily and answers 202 with an empty body while
// it works — a repo nobody has asked about in a while reliably 202s the first
// time. Retrying twice covers that; the page has already rendered, so the wait
// costs the reader nothing.
const RETRY_DELAY_MS = 2000
const MAX_ATTEMPTS = 3

/**
 * Turn GitHub's commit-activity payload into the last `weeks` weekly counts.
 *
 * GitHub weeks start on Sunday while our own series start on Monday, so the
 * two are labelled a day apart. Both label a week by its start date, which is
 * all a bar strip needs — they are never plotted on a shared axis.
 */
export function toWeeklySeries(raw: GitHubCommitActivityWeek[], weeks: number): WeeklyCount[] {
  return raw.slice(-weeks).map((entry) => ({
    week: new Date(entry.week * 1000).toISOString().slice(0, 10),
    count: entry.total,
  }))
}

/**
 * Commit counts per week for a public GitHub repo, or null when GitHub will
 * not answer (rate limit, offline, still computing). The caller shows a link
 * to the graph on GitHub instead — this is decoration, never a blocker.
 */
export async function fetchCommitActivity(repo: string, weeks: number): Promise<WeeklyCount[] | null> {
  const url = `https://api.github.com/repos/${repo}/stats/commit_activity`

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })

      if (response.status === 202) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        continue
      }
      if (!response.ok) return null

      const body = await response.json()
      if (!Array.isArray(body) || body.length === 0) return null
      return toWeeklySeries(body, weeks)
    } catch {
      return null
    }
  }

  return null
}
