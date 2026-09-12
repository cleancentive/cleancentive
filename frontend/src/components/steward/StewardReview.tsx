import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/adminStore'
import { ItemEditor, type DetectedItemData } from '../ItemEditor'
import { SpotImage } from '../SpotImage'
import { spotOriginalUrl, spotThumbnailUrl } from '../../lib/apiBase'

const SESSION_SIZE = 10

export function StewardReview() {
  const { t } = useTranslation(['steward', 'common'])
  const reviewQueue = useAdminStore((s) => s.reviewQueue)
  const reviewIndex = useAdminStore((s) => s.reviewIndex)
  const reviewStats = useAdminStore((s) => s.reviewStats)
  const isLoadingReview = useAdminStore((s) => s.isLoadingReview)
  const fetchReviewQueue = useAdminStore((s) => s.fetchReviewQueue)
  const fetchReviewStats = useAdminStore((s) => s.fetchReviewStats)
  const confirmSpotDetection = useAdminStore((s) => s.confirmSpotDetection)
  const advanceReviewQueue = useAdminStore((s) => s.advanceReviewQueue)

  useEffect(() => {
    fetchReviewQueue(SESSION_SIZE)
    fetchReviewStats()
  }, [fetchReviewQueue, fetchReviewStats])

  const current = reviewQueue[reviewIndex] ?? null
  const done = reviewIndex >= reviewQueue.length

  const confirm = useCallback(() => {
    if (current) void confirmSpotDetection(current.spotId)
  }, [current, confirmSpotDetection])

  // Keyboard-first: the fastest path through one spot is what keeps a review
  // session from feeling like a chore.
  useEffect(() => {
    if (!current) return

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        confirm()
      } else if (event.key === 'ArrowRight' || event.key === 's') {
        event.preventDefault()
        advanceReviewQueue()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, confirm, advanceReviewQueue])

  const startNextSession = () => {
    fetchReviewQueue(SESSION_SIZE)
    fetchReviewStats()
  }

  const agreementRate = reviewStats?.modelAgreement.rate

  return (
    <fieldset className="page-card steward-review-panel">
      <legend>{t('review.legend')}</legend>

      {reviewStats && (
        <div className="steward-review-stats">
          <span>{t('review.backlog', { count: reviewStats.backlog })}</span>
          <span>{t('review.teamThisWeek', { count: reviewStats.reviewedByTeamThisWeek })}</span>
          <span>{t('review.activeDays', { count: reviewStats.myActiveDays })}</span>
          {agreementRate !== null && agreementRate !== undefined && (
            <span>{t('review.agreement', { percent: Math.round(agreementRate * 100) })}</span>
          )}
        </div>
      )}

      {isLoadingReview && <p className="loading">{t('loading')}</p>}

      {!isLoadingReview && reviewQueue.length === 0 && (
        <p className="steward-review-empty">{t('review.nothingToReview')}</p>
      )}

      {!isLoadingReview && reviewQueue.length > 0 && done && (
        <div className="steward-review-done">
          <p>{t('review.sessionComplete', { count: reviewQueue.length })}</p>
          <button className="primary-button" onClick={startNextSession}>
            {t('review.startNextSession')}
          </button>
        </div>
      )}

      {current && (
        <div className="steward-review-spot">
          <p className="steward-review-progress">
            {t('review.progress', { current: reviewIndex + 1, total: reviewQueue.length })}
          </p>

          <SpotImage
            className="steward-review-image"
            thumbnailSrc={spotThumbnailUrl(current.spotId)}
            fullSrc={current.hasOriginal ? spotOriginalUrl(current.spotId) : null}
            alt={t('review.spotImageAlt')}
          />

          {current.items.length === 0 ? (
            <p className="steward-review-no-items">{t('review.modelFoundNothing')}</p>
          ) : (
            current.items.map((item) => (
              <ItemEditor
                key={item.id}
                spotId={current.spotId}
                item={item as DetectedItemData}
                subjectKind="litter"
                onUpdated={() => fetchReviewStats()}
                onRemoved={() => fetchReviewStats()}
              />
            ))
          )}

          <div className="steward-review-actions">
            <button className="primary-button" onClick={confirm}>
              {t('review.looksRight')}
            </button>
            <button className="secondary-button" onClick={advanceReviewQueue}>
              {t('review.skip')}
            </button>
            <span className="steward-review-hint">{t('review.keyboardHint')}</span>
          </div>
        </div>
      )}
    </fieldset>
  )
}
