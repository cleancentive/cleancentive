interface UserEmailLike {
  email: string
  is_selected_for_login: boolean
}

export function suggestNicknameFromEmail(emails: UserEmailLike[] | undefined): string {
  if (!emails || emails.length === 0) return ''
  const primary = emails.find((e) => e.is_selected_for_login) || emails[0]
  const localPart = primary.email.split('@')[0]
  const firstWord = localPart.split(/[._-]/)[0]
  if (!firstWord) return ''
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase()
}
