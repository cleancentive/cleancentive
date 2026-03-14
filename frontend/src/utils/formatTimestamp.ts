const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function time24(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function formatTimestamp(value: string | number | null | undefined): string {
  if (value == null) return 'n/a'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const todayStart = startOfDay(now)
  const yesterdayStart = todayStart - DAY

  if (date.getTime() >= todayStart) {
    if (diff < MINUTE) return 'just now'
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
    return time24(date)
  }

  if (date.getTime() >= yesterdayStart) {
    return `Yesterday ${time24(date)}`
  }

  if (diff < 7 * DAY) {
    return `${SHORT_DAYS[date.getDay()]} ${time24(date)}`
  }

  const day = date.getDate()
  const month = SHORT_MONTHS[date.getMonth()]

  if (date.getFullYear() === now.getFullYear()) {
    return `${day} ${month} ${time24(date)}`
  }

  return `${day} ${month} ${date.getFullYear()}`
}
