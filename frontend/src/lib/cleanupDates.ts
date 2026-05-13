import { isoToDatetimeLocal } from '../utils/datetime'

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

export function defaultStartFor(referenceDate?: string): string {
  const today = isoToDatetimeLocal(new Date().toISOString()).split('T')[0]
  const date = referenceDate ? referenceDate.split('T')[0] : today
  if (date === today) {
    return isoToDatetimeLocal(new Date().toISOString())
  }
  return date + 'T09:00'
}

export function defaultEndFrom(startAt: string): string {
  if (!startAt) return ''
  return startAt.split('T')[0] + 'T17:00'
}

export function durationHours(startAt: string, endAt: string): number | null {
  if (!startAt || !endAt) return null
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime()
  return ms / (1000 * 60 * 60)
}

export function isOngoing(startAt: string, endAt: string): boolean {
  const now = Date.now()
  return new Date(startAt).getTime() <= now && now <= new Date(endAt).getTime()
}

export function addOffset(date: Date, frequency: Frequency): Date {
  const d = new Date(date)
  switch (frequency) {
    case 'weekly': d.setDate(d.getDate() + 7); break
    case 'biweekly': d.setDate(d.getDate() + 14); break
    case 'monthly': d.setMonth(d.getMonth() + 1); break
    case 'quarterly': d.setMonth(d.getMonth() + 3); break
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break
  }
  return d
}

export function generateRecurringDates(
  startAt: string,
  endAt: string,
  frequency: Frequency,
  count: number,
): Array<{ startAt: string; endAt: string }> {
  const results: Array<{ startAt: string; endAt: string }> = []
  let s = new Date(startAt)
  let e = new Date(endAt)
  for (let i = 0; i < count; i++) {
    results.push({ startAt: s.toISOString(), endAt: e.toISOString() })
    s = addOffset(s, frequency)
    e = addOffset(e, frequency)
  }
  return results
}

// Assign distinct hue per recurrence_id
export function recurrenceColor(index: number, total: number): string {
  const hue = (index * 360 / Math.max(total, 1)) % 360
  return `hsl(${hue}, 70%, 55%)`
}
