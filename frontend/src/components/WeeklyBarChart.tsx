export interface WeeklyBarSegment {
  key: string
  label: string
  value: number
  color: string
}

export interface WeeklyBar {
  week: string
  segments: WeeklyBarSegment[]
}

function barTotal(bar: WeeklyBar): number {
  return bar.segments.reduce((sum, segment) => sum + segment.value, 0)
}

function describeBar(bar: WeeklyBar, total: number, format: (value: number) => string): string {
  const parts = bar.segments.filter((s) => s.value > 0).map((s) => `${s.label} ${format(s.value)}`)
  return parts.length > 1
    ? `${bar.week}: ${format(total)} (${parts.join(' · ')})`
    : `${bar.week}: ${format(total)}`
}

/**
 * Weekly counts as columns, optionally stacked.
 *
 * Segments are laid out with flex-grow rather than percentage heights so the
 * 2px separators between them come out of the available space instead of
 * overflowing the column. Zero-value segments are dropped so they cannot
 * contribute a stray separator.
 */
export function WeeklyBarChart({
  bars,
  maxBars = 12,
  emptyText,
  // Counts render as-is; money needs rounding and a currency, and a float total
  // would otherwise print as 38.900000000000006.
  formatValue = (value: number) => String(value),
}: {
  bars: WeeklyBar[]
  maxBars?: number
  emptyText: string
  formatValue?: (value: number) => string
}) {
  const visible = bars.slice(-maxBars)
  if (visible.length === 0) {
    return <p className="insights-empty">{emptyText}</p>
  }

  const totals = visible.map(barTotal)
  const maxTotal = Math.max(...totals, 1)

  return (
    <div className="weekly-chart">
      {visible.map((bar, index) => {
        const total = totals[index]
        return (
          <div key={bar.week} className="weekly-chart-col" title={describeBar(bar, total, formatValue)}>
            <span className="weekly-chart-value">{total > 0 ? formatValue(total) : ''}</span>
            <div className="weekly-chart-plot">
              <div className="weekly-chart-stack" style={{ height: `${(total / maxTotal) * 100}%` }}>
                {bar.segments
                  .filter((segment) => segment.value > 0)
                  .map((segment) => (
                    <div
                      key={segment.key}
                      className="weekly-chart-segment"
                      style={{ flexGrow: segment.value, backgroundColor: segment.color }}
                    />
                  ))}
              </div>
            </div>
            <span className="weekly-chart-label">{bar.week.slice(5)}</span>
          </div>
        )
      })}
    </div>
  )
}
