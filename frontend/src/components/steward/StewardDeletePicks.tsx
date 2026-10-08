import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { API_BASE, getAuthHeaders } from '../../lib/apiBase'
import { DeletePicksRange, type PickRange } from '../DeletePicksRange'

/**
 * The steward backstop for picks someone left behind: scoped by owner
 * and/or team, counted before anything is removed.
 */
export function StewardDeletePicks() {
  const { t } = useTranslation(['steward'])
  const [userId, setUserId] = useState('')
  const [teamId, setTeamId] = useState('')

  const params = (range: PickRange, dryRun: boolean) => ({
    user_id: userId.trim() || undefined,
    team_id: teamId.trim() || undefined,
    since: range.since,
    before: range.before,
    ...(dryRun ? { dry_run: 'true' } : {}),
  })

  const countPicks = async (range: PickRange) => {
    const response = await axios.delete<{ count: number }>(`${API_BASE}/admin/ops/spots`, {
      headers: getAuthHeaders(),
      params: params(range, true),
    })
    return response.data.count
  }

  const deletePicks = async (range: PickRange) => {
    const response = await axios.delete<{ deleted: number; remaining: number }>(`${API_BASE}/admin/ops/spots`, {
      headers: getAuthHeaders(),
      params: params(range, false),
    })
    return response.data
  }

  const hasScope = userId.trim().length > 0 || teamId.trim().length > 0

  return (
    <>
      <fieldset className="page-card">
        <legend>{t('deletePicks.scopeLegend')}</legend>
        <p className="calendar-hint">{t('deletePicks.scopeHint')}</p>
        <div className="steward-api-key-form">
          <label>
            {t('deletePicks.userId')}
            <input type="text" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" />
          </label>
          <label>
            {t('deletePicks.teamId')}
            <input type="text" value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="uuid" />
          </label>
        </div>
      </fieldset>
      <DeletePicksRange namespace="steward" countPicks={countPicks} deletePicks={deletePicks} disabled={!hasScope} />
    </>
  )
}
