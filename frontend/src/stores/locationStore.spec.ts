import { describe, expect, test } from 'bun:test'
import * as locationStore from './locationStore'
import type { LocationFix } from './locationStore'

const selectFreshCaptureLocation = (locationStore as unknown as {
  selectFreshCaptureLocation: (
    bestRecent: LocationFix | null,
    latest: LocationFix | null,
    now: number,
  ) => LocationFix | null
}).selectFreshCaptureLocation

const getFreshPositionOptions = (locationStore as unknown as {
  getFreshPositionOptions: () => PositionOptions
}).getFreshPositionOptions

describe('selectFreshCaptureLocation', () => {
  test('rejects stale bestRecent and latest fixes', () => {
    const now = 2_000_000
    const staleBest: LocationFix = {
      latitude: 47.19212745015023,
      longitude: 7.5042177417550855,
      accuracy: 7.410108988364564,
      timestamp: now - 120_000,
    }
    const staleLatest: LocationFix = {
      latitude: 47.2,
      longitude: 7.5,
      accuracy: 30,
      timestamp: now - 90_000,
    }

    expect(selectFreshCaptureLocation(staleBest, staleLatest, now)).toBeNull()
  })

  test('prefers a fresh bestRecent fix over latest', () => {
    const now = 2_000_000
    const bestRecent: LocationFix = {
      latitude: 47.19,
      longitude: 7.5,
      accuracy: 6,
      timestamp: now - 10_000,
    }
    const latest: LocationFix = {
      latitude: 47.2,
      longitude: 7.51,
      accuracy: 20,
      timestamp: now - 1_000,
    }

    expect(selectFreshCaptureLocation(bestRecent, latest, now)).toEqual(bestRecent)
  })

  test('falls back to a fresh latest fix when bestRecent is stale', () => {
    const now = 2_000_000
    const staleBest: LocationFix = {
      latitude: 47.19,
      longitude: 7.5,
      accuracy: 6,
      timestamp: now - 120_000,
    }
    const latest: LocationFix = {
      latitude: 47.2,
      longitude: 7.51,
      accuracy: 20,
      timestamp: now - 1_000,
    }

    expect(selectFreshCaptureLocation(staleBest, latest, now)).toEqual(latest)
  })

  test('requests an uncached high accuracy browser fix', () => {
    expect(getFreshPositionOptions()).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    })
  })
})
