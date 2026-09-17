import { describe, expect, test } from 'bun:test'
import { shouldFallBackToPast } from './cleanupStatus'
import type { CleanupStatus } from './cleanupStatus'

const upcoming = new Set<CleanupStatus>(['ongoing', 'future'])

describe('shouldFallBackToPast', () => {
  test('falls back when nothing is upcoming but past cleanups exist', () => {
    expect(shouldFallBackToPast(upcoming, { past: 13, ongoing: 0, future: 0 }, 0)).toBe(true)
  })

  test('stays put when the response had items', () => {
    expect(shouldFallBackToPast(upcoming, { past: 13, ongoing: 0, future: 0 }, 5)).toBe(false)
  })

  test('stays put when something is still ongoing or upcoming', () => {
    expect(shouldFallBackToPast(upcoming, { past: 13, ongoing: 1, future: 0 }, 0)).toBe(false)
    expect(shouldFallBackToPast(upcoming, { past: 13, ongoing: 0, future: 2 }, 0)).toBe(false)
  })

  test('stays put when there is nothing in the past either', () => {
    expect(shouldFallBackToPast(upcoming, { past: 0, ongoing: 0, future: 0 }, 0)).toBe(false)
  })

  test('stays put when past is already selected — the list is genuinely empty', () => {
    const all = new Set<CleanupStatus>(['ongoing', 'future', 'past'])
    expect(shouldFallBackToPast(all, { past: 13, ongoing: 0, future: 0 }, 0)).toBe(false)
  })

  test('stays put without counts', () => {
    expect(shouldFallBackToPast(upcoming, null, 0)).toBe(false)
  })
})
