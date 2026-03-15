import { useState } from 'react'
import { Avatar } from './Avatar'
import { formatTimestamp } from '../utils/formatTimestamp'

interface Message {
  id: string
  subject: string
  body: string
  audience: 'members' | 'admins'
  created_at: string
  author_user_id: string
  author?: { nickname: string; avatarEmailId: string | null }
}

interface MessageBoardProps {
  messages: Message[]
  onPost: (audience: 'members' | 'admins', subject: string, body: string) => Promise<void>
  canPost: boolean
  isAdmin: boolean
  isLoading: boolean
}

function getDisclosure(audience: 'members' | 'admins'): string {
  if (audience === 'members') {
    return 'All current and future team members will see this message in the history. An email will be sent to all current members.'
  }
  return 'All current and future admins will see this message in the history. An email will be sent to all current admins.'
}

export function MessageBoard({ messages, onPost, canPost, isAdmin, isLoading }: MessageBoardProps) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'members' | 'admins'>('admins')
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

  // Members can only write to admins — single option, no dropdown needed
  const hasMultipleAudienceOptions = isAdmin

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
                <select value={audience} onChange={(e) => setAudience(e.target.value as 'members' | 'admins')}>
                  <option value="members">All members</option>
                  <option value="admins">Admins</option>
                </select>
              ) : (
                <span className="message-audience-fixed">Admins</span>
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
              {msg.author && (
                <Avatar userId={msg.author_user_id} avatarEmailId={msg.author.avatarEmailId} nickname={msg.author.nickname} size={24} />
              )}
              <strong>{msg.author?.nickname || 'Unknown'}</strong>
              <span className="message-date">{formatTimestamp(msg.created_at)}</span>
              <span className="badge">{msg.audience === 'admins' ? 'To admins' : 'To members'}</span>
            </div>
            <h4 className="message-subject">{msg.subject}</h4>
            <p className="message-body">{msg.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
