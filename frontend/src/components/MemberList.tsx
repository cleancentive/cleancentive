import { useTranslation } from 'react-i18next'
import { UserDisplay } from './UserDisplay'

interface Member {
  userId: string
  nickname: string
  role: string
  avatarEmailId: string | null
  uploadedAvatarUpdatedAt: string | null
}

interface MemberListProps {
  members: Member[]
  canPromote: boolean
  onPromote?: (userId: string) => void
  entityLabel?: string
}

export function MemberList({ members, canPromote, onPromote, entityLabel = 'Member' }: MemberListProps) {
  const { t } = useTranslation(['cleanups', 'common'])
  const entity = entityLabel === 'Participant'
    ? t('cleanups:members.entityParticipant')
    : t('cleanups:members.entityMember')

  if (members.length === 0) {
    return <p className="end-of-list">{t('cleanups:members.empty', { entity })}</p>
  }

  return (
    <div className="member-list">
      {members.map((member) => (
        <div key={member.userId} className="member-item">
          <UserDisplay userId={member.userId} avatarEmailId={member.avatarEmailId} uploadedAvatarUpdatedAt={member.uploadedAvatarUpdatedAt} nickname={member.nickname} size={28} />
          {member.role === 'organizer' && <span className="badge admin-badge">{t('common:domain.organizer')}</span>}
          {member.role === 'member' && <span className="badge">{t('cleanups:members.roleMember')}</span>}
          {canPromote && member.role !== 'organizer' && onPromote && (
            <button className="link-button" onClick={() => onPromote(member.userId)}>
              {t('cleanups:members.promote')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
