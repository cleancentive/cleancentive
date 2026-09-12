import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/adminStore'
import { useVersionStore } from '../../stores/versionStore'
import { formatTimestamp } from '../../utils/formatTimestamp'
import { WeeklyBarChart, type WeeklyBar } from '../WeeklyBarChart'
import { FEEDBACK_STATUS_COLORS } from '../../lib/statusColors'
import { FEEDBACK_STATUSES } from '../../lib/feedbackUrlState'
import { fetchCommitActivity, type WeeklyCount } from '../../lib/commitActivity'

const REPO = 'cleancentive/cleancentive'
const REPO_URL = `https://github.com/${REPO}`
const SERIES_WEEKS = 12

function renderCommit(commit: string | undefined, commitShort: string | undefined) {
  if (!commit || !commitShort || commit === 'dev') {
    return commitShort ?? '-'
  }
  return (
    <a href={`${REPO_URL}/commit/${commit}`} target="_blank" rel="noopener noreferrer" title={commit}>
      {commitShort}
    </a>
  )
}

function formatBuildTime(buildTime: number | undefined) {
  return buildTime ? formatTimestamp(new Date(buildTime * 1000).toISOString()) : '-'
}

function singleSeries(counts: WeeklyCount[], label: string): WeeklyBar[] {
  return counts.map(({ week, count }) => ({
    week,
    segments: [{ key: 'count', label, value: count, color: 'var(--blue-500)' }],
  }))
}

export function StewardProject() {
  const { t } = useTranslation(['steward', 'common'])
  const { versionInfo, fetchVersionInfo } = useVersionStore()
  const feedbackCounts = useAdminStore((s) => s.feedbackCounts)
  const feedbackIntakeByWeek = useAdminStore((s) => s.feedbackIntakeByWeek)
  const signupsByWeek = useAdminStore((s) => s.signupsByWeek)
  const fetchFeedbackCounts = useAdminStore((s) => s.fetchFeedbackCounts)
  const fetchFeedbackIntakeByWeek = useAdminStore((s) => s.fetchFeedbackIntakeByWeek)
  const fetchSignupsByWeek = useAdminStore((s) => s.fetchSignupsByWeek)

  // GitHub is the only data source here the app does not own, so it stays
  // local to the page: nothing else needs it and it must never block render.
  const [commits, setCommits] = useState<WeeklyCount[] | null>(null)

  useEffect(() => {
    fetchVersionInfo()
    fetchFeedbackCounts()
    fetchFeedbackIntakeByWeek()
    fetchSignupsByWeek()
  }, [fetchVersionInfo, fetchFeedbackCounts, fetchFeedbackIntakeByWeek, fetchSignupsByWeek])

  useEffect(() => {
    let active = true
    fetchCommitActivity(REPO, SERIES_WEEKS).then((series) => {
      if (active) setCommits(series)
    })
    return () => {
      active = false
    }
  }, [])

  const feedbackBars: WeeklyBar[] = (feedbackIntakeByWeek ?? []).map((entry) => ({
    week: entry.week,
    segments: FEEDBACK_STATUSES.map((status) => ({
      key: status,
      label: t(`feedback.status.${status}`),
      value: entry.counts[status] ?? 0,
      color: FEEDBACK_STATUS_COLORS[status],
    })),
  }))

  return (
    <fieldset className="page-card">
      <legend>{t('project.legend')}</legend>

      <h3>{t('project.deployedVersions')}</h3>
      <div className="ops-version-table-wrap">
        <table className="ops-version-table">
          <thead>
            <tr>
              <th>{t('project.artifact')}</th>
              <th>{t('project.version')}</th>
              <th>{t('project.built')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('project.backend')}</td>
              <td className="ops-version-hash">{renderCommit(versionInfo?.backend?.commit, versionInfo?.backend?.commitShort)}</td>
              <td>{formatBuildTime(versionInfo?.backend?.buildTime)}</td>
            </tr>
            <tr>
              <td>{t('project.frontend')}</td>
              <td className="ops-version-hash">{renderCommit(__APP_COMMIT__, __APP_COMMIT_SHORT__)}</td>
              <td>{formatBuildTime(__APP_BUILD_TIME__)}</td>
            </tr>
            <tr>
              <td>{t('project.worker')}</td>
              <td className="ops-version-hash">{renderCommit(versionInfo?.worker?.commit, versionInfo?.worker?.commitShort)}</td>
              <td>{formatBuildTime(versionInfo?.worker?.buildTime)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="project-external-link">
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{t('project.repository')}</a>
      </p>

      <h3>{t('project.feedbackIntake')}</h3>
      <p className="project-section-hint">{t('project.feedbackIntakeHint')}</p>
      <WeeklyBarChart bars={feedbackBars} maxBars={SERIES_WEEKS} emptyText={t('project.noData')} />
      <div className="weekly-chart-legend">
        {FEEDBACK_STATUSES.map((status) => (
          <span key={status} className="weekly-chart-legend-item">
            <span className="weekly-chart-swatch" style={{ backgroundColor: FEEDBACK_STATUS_COLORS[status] }} />
            {t(`feedback.status.${status}`)}
            {feedbackCounts?.[status] != null ? ` (${feedbackCounts[status]})` : ''}
          </span>
        ))}
      </div>

      <h3>{t('project.signups')}</h3>
      <WeeklyBarChart
        bars={singleSeries(signupsByWeek ?? [], t('project.signups'))}
        maxBars={SERIES_WEEKS}
        emptyText={t('project.noData')}
      />

      <h3>{t('project.commits')}</h3>
      {commits && commits.length > 0 ? (
        <WeeklyBarChart
          bars={singleSeries(commits, t('project.commits'))}
          maxBars={SERIES_WEEKS}
          emptyText={t('project.noData')}
        />
      ) : (
        <p className="insights-empty">{t('project.commitsUnavailable')}</p>
      )}
      <p className="project-external-link">
        <a href={`${REPO_URL}/graphs/commit-activity`} target="_blank" rel="noopener noreferrer">
          {t('project.commitsOnGitHub')}
        </a>
      </p>
    </fieldset>
  )
}
