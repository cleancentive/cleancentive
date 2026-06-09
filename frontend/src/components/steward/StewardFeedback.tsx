import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAdminStore } from '../../stores/adminStore'
import { formatTimestamp } from '../../utils/formatTimestamp'
import { FEEDBACK_STATUS_COLORS } from '../../lib/statusColors'
import {
  FEEDBACK_STATUSES,
  parseFeedbackStatusFilter,
  serializeFeedbackStatusFilter,
} from '../../lib/feedbackUrlState'

export function StewardFeedback() {
  const { feedbackId: feedbackIdParam } = useParams<{ feedbackId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const feedbackItems = useAdminStore((s) => s.feedbackItems)
  const feedbackTotal = useAdminStore((s) => s.feedbackTotal)
  const feedbackCounts = useAdminStore((s) => s.feedbackCounts)
  const isLoadingFeedback = useAdminStore((s) => s.isLoadingFeedback)
  const isSubmittingResponse = useAdminStore((s) => s.isSubmittingResponse)
  const activeFeedbackItem = useAdminStore((s) => s.activeFeedbackItem)
  const fetchFeedback = useAdminStore((s) => s.fetchFeedback)
  const fetchFeedbackCounts = useAdminStore((s) => s.fetchFeedbackCounts)
  const fetchFeedbackDetail = useAdminStore((s) => s.fetchFeedbackDetail)
  const updateFeedbackStatus = useAdminStore((s) => s.updateFeedbackStatus)
  const addAdminResponse = useAdminStore((s) => s.addAdminResponse)

  // The URL ?status= param is the source of truth for the filter (deep-linkable, refresh-safe).
  const statusFilter = parseFeedbackStatusFilter(searchParams)
  const statusParam = searchParams.get('status')

  const [expandedFeedbackId, setExpandedFeedbackId] = useState<string | null>(null)
  const [adminReply, setAdminReply] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('')

  const toggleStatus = (status: string) => {
    const next = parseFeedbackStatusFilter(searchParams)
    if (next.has(status)) {
      next.delete(status)
    } else {
      next.add(status)
    }
    setSearchParams(serializeFeedbackStatusFilter(next), { replace: true })
  }

  useEffect(() => {
    // The permalink effect below fetches all statuses; don't fight it.
    if (feedbackIdParam) return
    fetchFeedback(parseFeedbackStatusFilter(searchParams))
    fetchFeedbackCounts()
    // Keyed on the raw status string so URL changes refetch; searchParams identity is unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusParam, feedbackIdParam, fetchFeedback, fetchFeedbackCounts])

  useEffect(() => {
    if (feedbackIdParam) {
      fetchFeedback(new Set())
      fetchFeedbackDetail(feedbackIdParam).then(() => {
        setExpandedFeedbackId(feedbackIdParam)
      })
    }
  }, [feedbackIdParam, fetchFeedback, fetchFeedbackDetail])

  return (
    <fieldset className="page-card">
      <legend>Feedback ({feedbackTotal})</legend>
      <div className="feedback-admin-filters">
        {FEEDBACK_STATUSES.map((s) => {
          const label = s === 'in_progress' ? 'In progress' : s.charAt(0).toUpperCase() + s.slice(1)
          const count = feedbackCounts?.[s]
          return (
            <button
              key={s}
              className={`filter-tab${statusFilter.has(s) ? ' filter-tab--active' : ''}`}
              onClick={() => toggleStatus(s)}
            >
              {label}{count != null ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      {isLoadingFeedback && <p className="loading">Loading...</p>}

      {!isLoadingFeedback && feedbackItems.length === 0 && (
        <p className="end-of-list">No feedback found.</p>
      )}

      <div className="feedback-admin-list">
        {feedbackItems.map((f) => (
          <div key={f.id} className="feedback-admin-item">
            <div
              className="feedback-admin-item-header"
              onClick={async () => {
                if (expandedFeedbackId === f.id) {
                  setExpandedFeedbackId(null)
                } else {
                  await fetchFeedbackDetail(f.id)
                  setExpandedFeedbackId(f.id)
                  setFeedbackStatus(f.status)
                  setAdminReply('')
                }
              }}
            >
              <span className="badge">{f.category}</span>
              <span className="badge" style={{ backgroundColor: FEEDBACK_STATUS_COLORS[f.status] || 'var(--color-status-new)', color: '#fff' }}>
                {f.status === 'in_progress' ? 'In progress' : f.status.replace('_', ' ')}
              </span>
              <span className="feedback-admin-description">{f.description.slice(0, 80)}{f.description.length > 80 ? '...' : ''}</span>
              <span className="feedback-admin-meta">
                {f.user_id
                  ? <Link to={`/steward/users/${f.user_id}`} onClick={(e) => e.stopPropagation()}>{f.submitter_nickname || 'Anonymous'}</Link>
                  : (f.submitter_nickname || 'Anonymous')
                } &middot; {formatTimestamp(f.created_at)}
                {f.responses.length > 0 && ` · ${f.responses.length} response${f.responses.length !== 1 ? 's' : ''}`}
              </span>
              <Link to={`/steward/feedback/${f.id}`} className="feedback-permalink" onClick={(e) => e.stopPropagation()} title="Permalink">🔗</Link>
            </div>

            {expandedFeedbackId === f.id && activeFeedbackItem && (
              <div className="feedback-admin-detail">
                <p className="feedback-detail-description">{activeFeedbackItem.description}</p>

                {activeFeedbackItem.error_context && (
                  <details>
                    <summary>Error context</summary>
                    <pre className="feedback-error-details">{JSON.stringify(activeFeedbackItem.error_context, null, 2)}</pre>
                  </details>
                )}

                {activeFeedbackItem.contact_email && (
                  <p><strong>Contact:</strong> {activeFeedbackItem.contact_email}</p>
                )}

                <div className="feedback-thread">
                  {activeFeedbackItem.responses.map((r) => (
                    <div key={r.id} className={`feedback-thread-message ${r.is_from_steward ? 'feedback-thread-message--steward' : 'feedback-thread-message--user'}`}>
                      <div className="feedback-thread-header">
                        <strong>
                          {r.is_from_steward
                            ? <>{r.created_by ? <Link to={`/steward/users/${r.created_by}`}>{r.author_nickname || 'Steward'}</Link> : (r.author_nickname || 'Steward')} <span className="badge steward-badge">Steward</span></>
                            : activeFeedbackItem.user_id ? <Link to={`/steward/users/${activeFeedbackItem.user_id}`}>{activeFeedbackItem.submitter_nickname || 'User'}</Link> : (activeFeedbackItem.submitter_nickname || 'User')
                          }
                        </strong>
                        <span className="feedback-thread-date">{formatTimestamp(r.created_at)}</span>
                      </div>
                      <p>{r.message}</p>
                    </div>
                  ))}
                </div>

                <div className="feedback-admin-actions">
                  <label>
                    Status:
                    <select value={feedbackStatus} onChange={(e) => setFeedbackStatus(e.target.value)}>
                      <option value="new">New</option>
                      <option value="acknowledged">Acknowledged</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    onClick={() => updateFeedbackStatus(f.id, feedbackStatus)}
                    disabled={feedbackStatus === f.status}
                  >
                    Update Status
                  </button>
                </div>

                <form
                  className="feedback-reply-form"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (!adminReply.trim()) return
                    if (isSubmittingResponse) return
                    await addAdminResponse(f.id, adminReply.trim())
                    setAdminReply('')
                  }}
                >
                  <textarea
                    value={adminReply}
                    onChange={(e) => setAdminReply(e.target.value)}
                    placeholder="Reply to this feedback..."
                    rows={2}
                  />
                  <button type="submit" className="primary-button" disabled={!adminReply.trim() || isSubmittingResponse}>
                    {isSubmittingResponse ? 'Sending…' : 'Send Reply'}
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </fieldset>
  )
}
