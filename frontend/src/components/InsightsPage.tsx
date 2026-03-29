import { useEffect } from 'react'
import { useInsightsStore } from '../stores/insightsStore'
import { useAuthStore } from '../stores/authStore'
import { useInsightsFilterStore, presetToSince, pickedUpFilterToParam } from '../stores/insightsFilterStore'

function formatWeight(grams: number): string {
  if (grams >= 1000000) return `${(grams / 1000000).toFixed(1)} t`
  if (grams >= 1000) return `${(grams / 1000).toFixed(1)} kg`
  return `${Math.round(grams)} g`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function BarChart({ data, valueKey, maxBars = 12 }: { data: Array<{ week: string; [key: string]: any }>; valueKey: string; maxBars?: number }) {
  const sliced = data.slice(-maxBars)
  if (sliced.length === 0) return <p className="insights-empty">No data yet</p>

  const maxValue = Math.max(...sliced.map(d => Number(d[valueKey]) || 0), 1)

  return (
    <div className="insights-bar-chart">
      {sliced.map((d) => {
        const value = Number(d[valueKey]) || 0
        const heightPct = (value / maxValue) * 100
        return (
          <div key={d.week} className="insights-bar-col" title={`${d.week}: ${formatNumber(value)}`}>
            <div className="insights-bar" style={{ height: `${heightPct}%` }} />
            <span className="insights-bar-label">{d.week.slice(5)}</span>
          </div>
        )
      })}
    </div>
  )
}

function RankTable({ rows, labelKey, countKey, emptyText }: { rows: Array<Record<string, any>>; labelKey: string; countKey: string; emptyText: string }) {
  if (rows.length === 0) return <p className="insights-empty">{emptyText}</p>

  const maxCount = Math.max(...rows.map(r => Number(r[countKey])), 1)

  return (
    <div className="insights-rank-table">
      {rows.map((row, i) => (
        <div key={row[labelKey]} className="insights-rank-row">
          <span className="insights-rank-num">{i + 1}</span>
          <span className="insights-rank-label">{row[labelKey]}</span>
          <div className="insights-rank-bar-wrap">
            <div className="insights-rank-bar" style={{ width: `${(Number(row[countKey]) / maxCount) * 100}%` }} />
          </div>
          <span className="insights-rank-count">{formatNumber(Number(row[countKey]))}</span>
        </div>
      ))}
    </div>
  )
}

export function InsightsPage() {
  const { stats, isLoading, error, fetchStats } = useInsightsStore()
  const { user } = useAuthStore()
  const { datePreset, pickedUpFilter, myFilter } = useInsightsFilterStore()

  const teamId = user?.active_team_id ?? undefined
  const cleanupDateId = user?.active_cleanup_date_id ?? undefined

  useEffect(() => {
    fetchStats({
      team_id: teamId,
      cleanup_date_id: cleanupDateId,
      since: presetToSince(datePreset),
      picked_up: pickedUpFilterToParam(pickedUpFilter),
      user_id: myFilter ? user?.id : undefined,
    })
  }, [fetchStats, teamId, cleanupDateId, datePreset, pickedUpFilter, myFilter, user?.id])

  const scopeLabel = user?.active_team_name
    ? `${user.active_team_name} Insights`
    : 'Community Overview'

  if (isLoading && !stats) {
    return <div className="insights-page"><p className="loading">Loading insights...</p></div>
  }

  if (error && !stats) {
    return <div className="insights-page"><p className="error-message">{error}</p></div>
  }

  if (!stats) return null

  const { summary, timeSeries, spotStats } = stats

  return (
    <div className="insights-page">
      <fieldset className="page-card">
        <legend>{scopeLabel}</legend>
        <div className="insights-summary-grid">
          <article className="insights-stat-card">
            <span className="insights-stat-value">{formatNumber(summary.totalCleanups)}</span>
            <span className="insights-stat-label">Cleanups</span>
          </article>
          <article className="insights-stat-card">
            <span className="insights-stat-value">{formatNumber(summary.totalUsers)}</span>
            <span className="insights-stat-label">Users</span>
          </article>
          <article className="insights-stat-card">
            <span className="insights-stat-value">{formatNumber(summary.totalTeams)}</span>
            <span className="insights-stat-label">Teams</span>
          </article>
          <article className="insights-stat-card">
            <span className="insights-stat-value">{formatNumber(summary.totalSpots)}</span>
            <span className="insights-stat-label">Picks</span>
          </article>
          <article className="insights-stat-card">
            <span className="insights-stat-value">{formatNumber(summary.totalItems)}</span>
            <span className="insights-stat-label">Items Detected</span>
          </article>
          <article className="insights-stat-card">
            <span className="insights-stat-value">{formatWeight(summary.estimatedWeightGrams)}</span>
            <span className="insights-stat-label">Weight (Estimate)</span>
          </article>
        </div>
      </fieldset>

      <fieldset className="page-card">
        <legend>Picks Over Time</legend>
        <BarChart data={timeSeries.spots} valueKey="count" />
      </fieldset>

      <fieldset className="page-card">
        <legend>Items Detected Over Time</legend>
        <BarChart data={timeSeries.items} valueKey="count" />
      </fieldset>

      <fieldset className="page-card">
        <legend>Estimated Weight Over Time</legend>
        <BarChart data={timeSeries.estimatedWeightGrams} valueKey="total" />
      </fieldset>

      <fieldset className="page-card">
        <legend>Cleanups Over Time</legend>
        <BarChart data={timeSeries.cleanups} valueKey="count" />
      </fieldset>

      <fieldset className="page-card">
        <legend>Top Objects</legend>
        <RankTable rows={spotStats.topObjects} labelKey="object" countKey="count" emptyText="No objects detected yet" />
      </fieldset>

      <fieldset className="page-card">
        <legend>Top Materials</legend>
        <RankTable rows={spotStats.topMaterials} labelKey="material" countKey="count" emptyText="No materials detected yet" />
      </fieldset>

      <fieldset className="page-card">
        <legend>Top Brands</legend>
        <RankTable rows={spotStats.topBrands} labelKey="brand" countKey="count" emptyText="No brands detected yet" />
      </fieldset>
    </div>
  )
}
