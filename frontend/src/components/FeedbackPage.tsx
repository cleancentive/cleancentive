import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useFeedbackStore } from '../stores/feedbackStore'
import { useAuthStore } from '../stores/authStore'
import { formatTimestamp } from '../utils/formatTimestamp'

const STATUS_COLORS: Record<string, string> = {
  new: '#888',
  acknowledged: '#3b82f6',
  in_progress: '#f59e0b',
  resolved: '#22c55e',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="badge" style={{ backgroundColor: STATUS_COLORS[status] || '#888', color: '#fff' }}>
      {status.replace('_', ' ')}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return <span className="badge">{category}</span>
}

function FeedbackList() {
  const { myFeedback, isLoadingMine, fetchMyFeedback } = useFeedbackStore()

  useEffect(() => {
    fetchMyFeedback()
  }, [fetchMyFeedback])

  if (isLoadingMine) {
    return <p className="loading">Loading your feedback...</p>
  }

  if (myFeedback.length === 0) {
    return <p className="end-of-list">No feedback submitted yet.</p>
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
            <span className="feedback-list-responses">{f.responses.length} response{f.responses.length !== 1 ? 's' : ''}</span>
          )}
        </Link>
      ))}
    </div>
  )
}

function FeedbackDetail() {
  const { id } = useParams<{ id: string }>()
  const { activeFeedback, isLoadingDetail, fetchFeedbackDetail, addResponse, error } = useFeedbackStore()
  const { user } = useAuthStore()
  const [replyMessage, setReplyMessage] = useState('')
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    if (id) fetchFeedbackDetail(id)
  }, [id, fetchFeedbackDetail])

  if (isLoadingDetail) {
    return <p className="loading">Loading...</p>
  }

  if (!activeFeedback) {
    return <p className="end-of-list">Feedback not found.</p>
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
      <Link to="/feedback" className="link-button">&larr; Back to feedback</Link>

      <fieldset className="page-card">
        <legend>
          <CategoryBadge category={activeFeedback.category} />
          {' '}
          <StatusBadge status={activeFeedback.status} />
        </legend>

        <p className="feedback-detail-description">{activeFeedback.description}</p>

        {activeFeedback.error_context && (
          <details className="feedback-error-context">
            <summary>Technical details</summary>
            <pre className="feedback-error-details">
              {JSON.stringify(activeFeedback.error_context, null, 2)}
            </pre>
          </details>
        )}

        <p className="feedback-detail-date">Submitted {formatTimestamp(activeFeedback.created_at)}</p>
      </fieldset>

      <fieldset className="page-card">
        <legend>Private conversation with CleanCentive stewards</legend>

        {activeFeedback.responses.length === 0 && (
          <p className="end-of-list">No responses yet. A steward will get back to you.</p>
        )}

        <div className="feedback-thread">
          {activeFeedback.responses.map((r) => (
            <div key={r.id} className={`feedback-thread-message ${r.is_from_steward ? 'feedback-thread-message--steward' : 'feedback-thread-message--user'}`}>
              <div className="feedback-thread-header">
                <strong>
                  {r.is_from_steward
                    ? <>{r.author_nickname || 'Steward'} <span className="badge steward-badge">Steward</span></>
                    : 'You'
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
              placeholder="Write a follow-up..."
              rows={2}
              required
            />
            {error && <p className="error-message">{error}</p>}
            <button type="submit" className="primary-button" disabled={isSending || !replyMessage.trim()}>
              {isSending ? 'Sending...' : 'Reply'}
            </button>
          </form>
        )}
      </fieldset>
    </>
  )
}

export function FeedbackPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="feedback-page">
      <h2>My Feedback</h2>
      {id ? <FeedbackDetail /> : <FeedbackList />}
    </div>
  )
}
