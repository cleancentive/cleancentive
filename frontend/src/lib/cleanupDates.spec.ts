import { describe, test, expect } from 'bun:test'
import {
  defaultEndFrom,
  durationHours,
  isOngoing,
  addOffset,
  generateRecurringDates,
  recurrenceColor,
} from './cleanupDates'

describe('defaultEndFrom', () => {
  test('returns 17:00 on the same date as start', () => {
    expect(defaultEndFrom('2026-06-15T09:00')).toBe('2026-06-15T17:00')
  })

  test('returns empty string for empty input', () => {
    expect(defaultEndFrom('')).toBe('')
  })
})

describe('durationHours', () => {
  test('computes hours between start and end', () => {
    expect(durationHours('2026-06-15T09:00', '2026-06-15T11:00')).toBe(2)
    expect(durationHours('2026-06-15T09:00', '2026-06-15T09:30')).toBe(0.5)
  })

  test('returns null for empty inputs', () => {
    expect(durationHours('', '2026-06-15T11:00')).toBeNull()
    expect(durationHours('2026-06-15T09:00', '')).toBeNull()
  })

  test('returns negative for end before start', () => {
    expect(durationHours('2026-06-15T11:00', '2026-06-15T09:00')).toBe(-2)
  })
})

describe('isOngoing', () => {
  test('true when now is between start and end', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(isOngoing(past, future)).toBe(true)
  })

  test('false when start is in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const farFuture = new Date(Date.now() + 120_000).toISOString()
    expect(isOngoing(future, farFuture)).toBe(false)
  })

  test('false when end is in the past', () => {
    const farPast = new Date(Date.now() - 120_000).toISOString()
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(isOngoing(farPast, past)).toBe(false)
  })
})

describe('addOffset', () => {
  test('weekly adds 7 days', () => {
    const base = new Date('2026-06-15T09:00:00.000Z')
    const result = addOffset(base, 'weekly')
    expect(result.toISOString()).toBe('2026-06-22T09:00:00.000Z')
  })

  test('biweekly adds 14 days', () => {
    const base = new Date('2026-06-15T09:00:00.000Z')
    const result = addOffset(base, 'biweekly')
    expect(result.toISOString()).toBe('2026-06-29T09:00:00.000Z')
  })

  test('monthly advances by one month', () => {
    const base = new Date('2026-06-15T09:00:00.000Z')
    const result = addOffset(base, 'monthly')
    expect(result.getUTCMonth()).toBe(6) // July (0-indexed)
    expect(result.getUTCDate()).toBe(15)
  })

  test('quarterly advances by three months', () => {
    const base = new Date('2026-01-15T09:00:00.000Z')
    const result = addOffset(base, 'quarterly')
    expect(result.getUTCMonth()).toBe(3) // April
  })

  test('yearly advances by one year', () => {
    const base = new Date('2026-06-15T09:00:00.000Z')
    const result = addOffset(base, 'yearly')
    expect(result.getUTCFullYear()).toBe(2027)
  })

  test('does not mutate input date', () => {
    const base = new Date('2026-06-15T09:00:00.000Z')
    const before = base.toISOString()
    addOffset(base, 'weekly')
    expect(base.toISOString()).toBe(before)
  })
})

describe('generateRecurringDates', () => {
  test('produces N entries with monotonically increasing starts', () => {
    const result = generateRecurringDates('2026-06-15T09:00:00.000Z', '2026-06-15T11:00:00.000Z', 'weekly', 4)
    expect(result).toHaveLength(4)
    for (let i = 1; i < result.length; i++) {
      expect(result[i].startAt > result[i - 1].startAt).toBe(true)
    }
  })

  test('first entry equals input start/end', () => {
    const result = generateRecurringDates('2026-06-15T09:00:00.000Z', '2026-06-15T11:00:00.000Z', 'weekly', 2)
    expect(result[0].startAt).toBe('2026-06-15T09:00:00.000Z')
    expect(result[0].endAt).toBe('2026-06-15T11:00:00.000Z')
  })

  test('count of 1 yields single entry', () => {
    const result = generateRecurringDates('2026-06-15T09:00:00.000Z', '2026-06-15T11:00:00.000Z', 'weekly', 1)
    expect(result).toHaveLength(1)
  })
})

describe('recurrenceColor', () => {
  test('distinct hues for distinct indices in same total', () => {
    const a = recurrenceColor(0, 3)
    const b = recurrenceColor(1, 3)
    expect(a).not.toBe(b)
  })

  test('returns hsl string', () => {
    expect(recurrenceColor(0, 1)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
  })
})
