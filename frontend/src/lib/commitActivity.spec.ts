import { describe, test, expect } from 'bun:test'
import { toWeeklySeries } from './commitActivity'

// GitHub reports week starts as Unix seconds at midnight UTC on a Sunday.
const week = (iso: string, total: number) => ({ week: Date.parse(`${iso}T00:00:00Z`) / 1000, total })

describe('toWeeklySeries', () => {
  test('labels each week by its start date', () => {
    expect(toWeeklySeries([week('2026-08-30', 4), week('2026-09-06', 11)], 12)).toEqual([
      { week: '2026-08-30', count: 4 },
      { week: '2026-09-06', count: 11 },
    ])
  })

  test('keeps the most recent weeks when GitHub returns a full year', () => {
    const raw = [week('2026-08-16', 1), week('2026-08-23', 2), week('2026-08-30', 3)]
    expect(toWeeklySeries(raw, 2)).toEqual([
      { week: '2026-08-23', count: 2 },
      { week: '2026-08-30', count: 3 },
    ])
  })

  test('keeps quiet weeks so the axis does not compress', () => {
    const raw = [week('2026-08-23', 0), week('2026-08-30', 5)]
    expect(toWeeklySeries(raw, 12)).toEqual([
      { week: '2026-08-23', count: 0 },
      { week: '2026-08-30', count: 5 },
    ])
  })

  test('returns an empty series for an empty payload', () => {
    expect(toWeeklySeries([], 12)).toEqual([])
  })
})
