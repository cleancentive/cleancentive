import { UserDisplay } from './UserDisplay'

interface Member {
  userId: string
  nickname: string
  role: string
  avatarEmailId: string | null
}

interface MemberListProps {
  members: Member[]
  canPromote: boolean
  onPromote?: (userId: string) => void
  entityLabel?: string
}

export function MemberList({ members, canPromote, onPromote, entityLabel = 'Member' }: MemberListProps) {
  if (members.length === 0) {
    return <p className="end-of-list">No {entityLabel.toLowerCase()}s yet</p>
  }

  return (
    <div className="member-list">
      {members.map((member) => (
        <div key={member.userId} className="member-item">
          <UserDisplay userId={member.userId} avatarEmailId={member.avatarEmailId} nickname={member.nickname} size={28} />
          {member.role === 'admin' && <span className="badge admin-badge">Admin</span>}
          {canPromote && member.role !== 'admin' && onPromote && (
            <button className="link-button" onClick={() => onPromote(member.userId)}>
              Promote
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
