import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackLink } from './BackLink'
import { useFeedbackStore } from '../stores/feedbackStore'
import { useAuthStore } from '../stores/authStore'
import { formatTimestamp } from '../utils/formatTimestamp'
import { FEEDBACK_STATUS_COLORS } from '../lib/statusColors'

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation(['feedback', 'common'])
  return (
    <span className="badge" style={{ backgroundColor: FEEDBACK_STATUS_COLORS[status] || 'var(--color-status-new)', color: '#fff' }}>
      {t(`status.${status}`, { defaultValue: status.replace('_', ' ') })}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const { t } = useTranslation(['feedback', 'common'])
  return <span className="badge">{t(`category.${category}`, { defaultValue: category })}</span>
}

function FeedbackList() {
  const { t } = useTranslation(['feedback', 'common'])
  const { myFeedback, isLoadingMine, fetchMyFeedback } = useFeedbackStore()

  useEffect(() => {
    fetchMyFeedback()
  }, [fetchMyFeedback])

  if (isLoadingMine) {
    return <p className="loading">{t('list.loading')}</p>
  }

  if (myFeedback.length === 0) {
    return <p className="end-of-list">{t('list.empty')}</p>
  }

  return (
    <div className="feedback-list">
      {myFeedback.map((f) => (
        <Link key={f.id} to={`/feedback/${f.id}`} className="feedback-list-item">
          <div className="feedback-list-item-header">
            <CategoryBadge category={f.category} />
            <StatusBadge status={f.status} />
            <span className="feedback-list-date">{formatTimestamp(f.created_at)}</span>
          </div>
          <p className="feedback-list-description">{f.description.slice(0, 120)}{f.description.length > 120 ? '...' : ''}</p>
          {f.responses.length > 0 && (
            <span className="feedback-list-responses">{t('list.responses', { count: f.responses.length })}</span>
          )}
        </Link>
      ))}
    </div>
  )
}

function FeedbackDetail() {
  const { t } = useTranslation(['feedback', 'common'])
  const { id } = useParams<{ id: string }>()
  const { activeFeedback, isLoadingDetail, fetchFeedbackDetail, addResponse, error } = useFeedbackStore()
  const { user } = useAuthStore()
  const [replyMessage, setReplyMessage] = useState('')
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    if (id) fetchFeedbackDetail(id)
  }, [id, fetchFeedbackDetail])

  if (isLoadingDetail) {
    return <p className="loading">{t('common:actions.loading')}</p>
  }

  if (!activeFeedback) {
    return <p className="end-of-list">{t('detail.notFound')}</p>
  }

  const canReply = !!user || !!activeFeedback.contact_email

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!replyMessage.trim() || !id) return
    setIsSending(true)
    await addResponse(id, replyMessage.trim())
    setReplyMessage('')
    setIsSending(false)
  }

  return (
    <>
      <BackLink to="/feedback" fallbackNoun="feedback" className="link-button" />

      <fieldset className="page-card">
        <legend>
          <CategoryBadge category={activeFeedback.category} />
          {' '}
          <StatusBadge status={activeFeedback.status} />
        </legend>

        <p className="feedback-detail-description">{activeFeedback.description}</p>

        {activeFeedback.error_context && (
          <details className="feedback-error-context">
            <summary>{t('detail.technicalDetails')}</summary>
            <pre className="feedback-error-details">
              {JSON.stringify(activeFeedback.error_context, null, 2)}
            </pre>
          </details>
        )}

        <p className="feedback-detail-date">{t('detail.submitted', { date: formatTimestamp(activeFeedback.created_at) })}</p>
      </fieldset>

      <fieldset className="page-card">
        <legend>{t('detail.conversationLegend')}</legend>

        {activeFeedback.responses.length === 0 && (
          <p className="end-of-list">{t('detail.noResponses')}</p>
        )}

        <div className="feedback-thread">
          {activeFeedback.responses.map((r) => (
            <div key={r.id} id={`response-${r.id}`} className={`feedback-thread-message ${r.is_from_steward ? 'feedback-thread-message--steward' : 'feedback-thread-message--user'}`}>
              <div className="feedback-thread-header">
                <strong>
                  {r.is_from_steward
                    ? <>{r.author_nickname || t('detail.steward')} <span className="badge steward-badge">{t('detail.steward')}</span></>
                    : t('detail.you')
                  }
                </strong>
                <span className="feedback-thread-date">{formatTimestamp(r.created_at)}</span>
              </div>
              <p>{r.message}</p>
            </div>
          ))}
        </div>

        {canReply && (
          <form className="feedback-reply-form" onSubmit={handleReply}>
            <textarea
              value={replyMessage}
              onChange={(e) => setReplyMessage(e.target.value)}
              placeholder={t('detail.replyPlaceholder')}
              rows={2}
              required
            />
            {error && <p className="error-message">{error}</p>}
            <button type="submit" className="primary-button" disabled={isSending || !replyMessage.trim()}>
              {isSending ? t('detail.sending') : t('detail.reply')}
            </button>
          </form>
        )}
      </fieldset>
    </>
  )
}

export function FeedbackPage() {
  const { t } = useTranslation(['feedback', 'common'])
  const { id } = useParams<{ id: string }>()

  return (
    <div className="feedback-page">
      <h2>{t('page.title')}</h2>
      {id ? <FeedbackDetail /> : <FeedbackList />}
    </div>
  )
}
