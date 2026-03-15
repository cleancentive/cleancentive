import { Avatar } from './Avatar'

export function UserDisplay({
  userId,
  avatarEmailId,
  nickname,
  size = 28,
  showAvatar = true,
}: {
  userId: string
  avatarEmailId?: string | null
  nickname: string
  size?: number
  showAvatar?: boolean
}) {
  return (
    <span className="user-display">
      {showAvatar && (
        <Avatar userId={userId} avatarEmailId={avatarEmailId} nickname={nickname} size={size} />
      )}
      <span className="user-display-nickname">{nickname}</span>
    </span>
  )
}
