import { useState } from 'react'
import { UserDisplay } from './UserDisplay'
import { formatTimestamp } from '../utils/formatTimestamp'

interface Message {
  id: string
  subject: string
  body: string
  audience: 'members' | 'organizers'
  created_at: string
  author_user_id: string
  author?: { nickname: string; avatarEmailId: string | null }
}

interface MessageBoardProps {
  messages: Message[]
  onPost: (audience: 'members' | 'organizers', subject: string, body: string) => Promise<void>
  canPost: boolean
  isOrganizer: boolean
  isLoading: boolean
}

function getDisclosure(audience: 'members' | 'organizers'): string {
  if (audience === 'members') {
    return 'All current and future team members will see this message in the history. An email will be sent to all current members.'
  }
  return 'All current and future organizers will see this message in the history. An email will be sent to all current organizers.'
}

export function MessageBoard({ messages, onPost, canPost, isOrganizer, isLoading }: MessageBoardProps) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'members' | 'organizers'>('organizers')
  const [isSending, setIsSending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) return
    setIsSending(true)
    try {
      await onPost(audience, subject.trim(), body.trim())
      setSubject('')
      setBody('')
    } finally {
      setIsSending(false)
    }
  }

  // Members can only write to organizers — single option, no dropdown needed
  const hasMultipleAudienceOptions = isOrganizer

  return (
    <div className="message-board">
      {canPost && (
        <form className="message-compose" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="search-input"
            required
          />
          <textarea
            placeholder="Write a message..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="message-textarea"
            rows={3}
            required
          />
          <p className="message-disclosure">{getDisclosure(audience)}</p>
          <div className="message-compose-footer">
            <label>
              To:
              {hasMultipleAudienceOptions ? (
                <select value={audience} onChange={(e) => setAudience(e.target.value as 'members' | 'organizers')}>
                  <option value="members">All members</option>
                  <option value="organizers">Organizers</option>
                </select>
              ) : (
                <span className="message-audience-fixed">Organizers</span>
              )}
            </label>
            <button type="submit" className="primary-button" disabled={isSending || !subject.trim() || !body.trim()}>
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="loading">Loading messages...</p>}

      {!isLoading && messages.length === 0 && (
        <p className="end-of-list">No messages yet</p>
      )}

      <div className="message-list">
        {messages.map((msg) => (
          <div key={msg.id} className="message-item">
            <div className="message-header">
              <UserDisplay
                userId={msg.author_user_id}
                avatarEmailId={msg.author?.avatarEmailId}
                nickname={msg.author?.nickname || 'Unknown'}
                size={24}
                showAvatar={!!msg.author}
              />
              <span className="message-date">{formatTimestamp(msg.created_at)}</span>
              <span className="badge">{msg.audience === 'organizers' ? 'To organizers' : 'To members'}</span>
            </div>
            <h4 className="message-subject">{msg.subject}</h4>
            <p className="message-body">{msg.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
