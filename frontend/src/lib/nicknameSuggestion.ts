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

export function suggestFullNameFromEmail(emails: UserEmailLike[] | undefined): string {
  if (!emails || emails.length === 0) return ''
  const primary = emails.find((e) => e.is_selected_for_login) || emails[0]
  const localPart = primary.email.split('@')[0]
  const words = localPart
    .split(/[._-]+/)
    .map((w) => w.replace(/\d+$/, '')) // strip trailing digits, e.g. cullmann42 -> cullmann
    .filter(Boolean)
  if (words.length < 2) return '' // can't derive a full name from a single token (e.g. "mcullmann")
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
