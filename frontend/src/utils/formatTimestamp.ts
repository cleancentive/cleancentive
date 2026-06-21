import i18n from '../i18n'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function activeLocale(): string {
  return i18n.resolvedLanguage || i18n.language || 'en'
}

function timeOnly(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

/**
 * Locale-aware relative/absolute timestamp, keyed to the active UI language.
 * Recent values render relative ("just now", "2 minutes ago", "yesterday"),
 * older ones absolute (weekday, then date). Formatting is delegated to Intl, so
 * month/day names and relative phrasing follow the locale.
 */
export function formatTimestamp(value: string | number | null | undefined): string {
  if (value == null) return 'n/a'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const locale = activeLocale()
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const todayStart = startOfDay(now)
  const yesterdayStart = todayStart - DAY

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (date.getTime() >= todayStart) {
    if (diff < MINUTE) return rtf.format(0, 'second')
    if (diff < HOUR) {
      return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(
        -Math.floor(diff / MINUTE),
        'minute',
      )
    }
    return timeOnly(date, locale)
  }

  if (date.getTime() >= yesterdayStart) {
    // "Yesterday" / "Gestern" / "Hier", capitalized, plus the time.
    const word = rtf.format(-1, 'day')
    const label = word.charAt(0).toUpperCase() + word.slice(1)
    return `${label} ${timeOnly(date, locale)}`
  }

  if (diff < 7 * DAY) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
    return `${weekday} ${timeOnly(date, locale)}`
  }

  if (date.getFullYear() === now.getFullYear()) {
    const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)
    return `${dayMonth} ${timeOnly(date, locale)}`
  }

  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}
