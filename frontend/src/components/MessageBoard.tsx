import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserDisplay } from './UserDisplay'
import { formatTimestamp } from '../utils/formatTimestamp'

interface Message {
  id: string
  subject: string
  body: string
  audience: 'members' | 'organizers'
  created_at: string
  author_user_id: string
  author?: { nickname: string; avatarEmailId: string | null; uploadedAvatarUpdatedAt: string | null }
}

interface MessageBoardProps {
  messages: Message[]
  onPost: (audience: 'members' | 'organizers', subject: string, body: string, ccSender: boolean) => Promise<void>
  canPost: boolean
  isOrganizer: boolean
  isLoading: boolean
}

export function MessageBoard({ messages, onPost, canPost, isOrganizer, isLoading }: MessageBoardProps) {
  const { t } = useTranslation(['cleanups'])
  const getDisclosure = (audience: 'members' | 'organizers'): string =>
    audience === 'members'
      ? t('cleanups:messages.disclosureMembers')
      : t('cleanups:messages.disclosureOrganizers')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'members' | 'organizers'>('organizers')
  const [ccSender, setCcSender] = useState(false)
  const [isSending, setIsSending] = useState(false)

  // Messages load asynchronously, so the browser's native hash scroll fires before the
  // target message exists in the DOM. Re-run the scroll once messages are rendered.
  useEffect(() => {
    if (isLoading || messages.length === 0) return
    const hash = window.location.hash
    if (!hash.startsWith('#message-')) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' })
  }, [messages, isLoading])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) return
    setIsSending(true)
    try {
      await onPost(audience, subject.trim(), body.trim(), ccSender)
      setSubject('')
      setBody('')
      setCcSender(false)
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
            placeholder={t('cleanups:messages.subjectPlaceholder')}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="search-input"
            required
          />
          <textarea
            placeholder={t('cleanups:messages.bodyPlaceholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="message-textarea"
            rows={3}
            required
          />
          <p className="message-disclosure">{getDisclosure(audience)}</p>
          <label className="message-cc-self">
            <input type="checkbox" checked={ccSender} onChange={(e) => setCcSender(e.target.checked)} />
            {t('cleanups:messages.ccSelf')}
          </label>
          <div className="message-compose-footer">
            <label>
              {t('cleanups:messages.to')}
              {hasMultipleAudienceOptions ? (
                <select value={audience} onChange={(e) => setAudience(e.target.value as 'members' | 'organizers')}>
                  <option value="members">{t('cleanups:messages.audienceMembers')}</option>
                  <option value="organizers">{t('cleanups:messages.audienceOrganizers')}</option>
                </select>
              ) : (
                <span className="message-audience-fixed">{t('cleanups:messages.audienceOrganizers')}</span>
              )}
            </label>
            <button type="submit" className="primary-button" disabled={isSending || !subject.trim() || !body.trim()}>
              {isSending ? t('cleanups:messages.sending') : t('cleanups:messages.send')}
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="loading">{t('cleanups:messages.loading')}</p>}

      {!isLoading && messages.length === 0 && (
        <p className="end-of-list">{t('cleanups:messages.empty')}</p>
      )}

      <div className="message-list">
        {messages.map((msg) => (
          <div key={msg.id} id={`message-${msg.id}`} className="message-item">
            <div className="message-header">
              <UserDisplay
                userId={msg.author_user_id}
                avatarEmailId={msg.author?.avatarEmailId}
                uploadedAvatarUpdatedAt={msg.author?.uploadedAvatarUpdatedAt}
                nickname={msg.author?.nickname || t('cleanups:messages.unknownAuthor')}
                size={24}
                showAvatar={!!msg.author}
              />
              <a className="message-date" href={`#message-${msg.id}`} title={new Date(msg.created_at).toLocaleString()}>
                {formatTimestamp(msg.created_at)}
              </a>
              <span className="badge">{msg.audience === 'organizers' ? t('cleanups:messages.toOrganizers') : t('cleanups:messages.toMembers')}</span>
            </div>
            <h4 className="message-subject">{msg.subject}</h4>
            <p className="message-body">{msg.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
