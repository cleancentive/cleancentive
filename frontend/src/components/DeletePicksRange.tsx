import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { ConfirmDialog } from './ConfirmDialog'

export interface PickRange {
  /** ISO 8601, inclusive. */
  since: string
  /** ISO 8601, exclusive. */
  before: string
}

interface DeletePicksRangeProps {
  /** Which locale file holds the `deletePicks.*` strings. */
  namespace: 'profile' | 'steward'
  countPicks: (range: PickRange) => Promise<number>
  deletePicks: (range: PickRange) => Promise<{ deleted: number; remaining: number }>
  disabled?: boolean
}

function toIso(local: string): string | null {
  const date = new Date(local)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Count first, then delete: the dry run shows what a range covers before
 * anything goes. Deletion is capped per call, so the button stays armed while
 * the server reports picks remaining.
 */
export function DeletePicksRange({ namespace, countPicks, deletePicks, disabled = false }: DeletePicksRangeProps) {
  const { t } = useTranslation([namespace, 'common'])
  const [sinceLocal, setSinceLocal] = useState('')
  const [beforeLocal, setBeforeLocal] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<{ deleted: number; remaining: number } | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  const range = (): PickRange | null => {
    const since = toIso(sinceLocal)
    const before = toIso(beforeLocal)
    return since && before && since < before ? { since, before } : null
  }

  const describeError = (err: unknown) =>
    axios.isAxiosError(err) && err.response?.data?.message ? String(err.response.data.message) : t('deletePicks.error')

  const handleCount = async (event: FormEvent) => {
    event.preventDefault()
    const selected = range()
    if (!selected) return
    setIsBusy(true)
    setError(null)
    setOutcome(null)
    try {
      setCount(await countPicks(selected))
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsBusy(false)
    }
  }

  const handleDelete = async () => {
    setIsConfirming(false)
    const selected = range()
    if (!selected) return
    setIsBusy(true)
    setError(null)
    try {
      const result = await deletePicks(selected)
      setOutcome(result)
      setCount(result.remaining)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsBusy(false)
    }
  }

  const canDelete = count !== null && count > 0 && range() !== null

  return (
    <fieldset className="page-card delete-picks" disabled={disabled || isBusy}>
      <legend>{t('deletePicks.legend')}</legend>
      <p className="calendar-hint">{t('deletePicks.hint')}</p>

      <form onSubmit={handleCount} className="delete-picks-form">
        <label>
          {t('deletePicks.from')}
          <input type="datetime-local" value={sinceLocal} required onChange={(e) => { setSinceLocal(e.target.value); setCount(null); setOutcome(null) }} />
        </label>
        <label>
          {t('deletePicks.to')}
          <input type="datetime-local" value={beforeLocal} required onChange={(e) => { setBeforeLocal(e.target.value); setCount(null); setOutcome(null) }} />
        </label>
        <div className="delete-picks-actions">
          <button type="submit" className="secondary-button" disabled={disabled || isBusy || range() === null}>
            {t('deletePicks.count')}
          </button>
          <button type="button" className="danger-button" disabled={disabled || isBusy || !canDelete} onClick={() => setIsConfirming(true)}>
            {t('deletePicks.delete')}
          </button>
        </div>
      </form>

      {count !== null && outcome === null && (
        <p className="delete-picks-result">{t('deletePicks.countResult', { count })}</p>
      )}
      {outcome && (
        <p className="delete-picks-result">
          {t('deletePicks.result', { count: outcome.deleted })}
          {outcome.remaining > 0 && ` ${t('deletePicks.remaining', { count: outcome.remaining })}`}
        </p>
      )}
      {error && <div className="error-message">{error}</div>}

      {isConfirming && (
        <ConfirmDialog title={t('deletePicks.confirmTitle')} actions={
          <>
            <button type="button" className="danger-button" onClick={handleDelete}>
              {t('deletePicks.delete')}
            </button>
            <button type="button" className="secondary-button" onClick={() => setIsConfirming(false)}>
              {t('common:actions.cancel')}
            </button>
          </>
        }>
          <p>{t('deletePicks.confirmPrompt', { count: count ?? 0 })}</p>
        </ConfirmDialog>
      )}
    </fieldset>
  )
}
