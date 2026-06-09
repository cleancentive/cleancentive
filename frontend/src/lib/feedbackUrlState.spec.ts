import { describe, test, expect } from 'bun:test'
import {
  parseFeedbackStatusFilter,
  serializeFeedbackStatusFilter,
  DEFAULT_FEEDBACK_STATUS_FILTER,
} from './feedbackUrlState'

describe('parseFeedbackStatusFilter', () => {
  test('absent param → default filter (anything but resolved)', () => {
    const result = parseFeedbackStatusFilter(new URLSearchParams(''))
    expect([...result].sort()).toEqual([...DEFAULT_FEEDBACK_STATUS_FILTER].sort())
    expect(result.has('resolved')).toBe(false)
  })

  test('present param → exactly the selected statuses', () => {
    const result = parseFeedbackStatusFilter(new URLSearchParams('status=new,resolved'))
    expect([...result].sort()).toEqual(['new', 'resolved'])
  })

  test('empty param → empty set (show all)', () => {
    const result = parseFeedbackStatusFilter(new URLSearchParams('status='))
    expect(result.size).toBe(0)
  })

  test('drops invalid statuses', () => {
    const result = parseFeedbackStatusFilter(new URLSearchParams('status=new,bogus,closed'))
    expect([...result]).toEqual(['new'])
  })
})

describe('serializeFeedbackStatusFilter', () => {
  test('encodes selection in canonical order', () => {
    const params = serializeFeedbackStatusFilter(new Set(['resolved', 'new', 'in_progress']))
    expect(params.get('status')).toBe('new,in_progress,resolved')
  })

  test('empty selection → empty status param', () => {
    const params = serializeFeedbackStatusFilter(new Set())
    expect(params.get('status')).toBe('')
    expect(params.toString()).toBe('status=')
  })

  test('round-trips through parse', () => {
    const original = new Set(['new', 'acknowledged'])
    const params = serializeFeedbackStatusFilter(original)
    const parsed = parseFeedbackStatusFilter(new URLSearchParams(params.toString()))
    expect([...parsed].sort()).toEqual([...original].sort())
  })
})
