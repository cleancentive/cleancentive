import { describe, test, expect } from 'bun:test'
import { parseMapState, serializeMapState } from './mapUrlState'

describe('serializeMapState', () => {
  test('omits all defaults', () => {
    expect(serializeMapState({}).toString()).toBe('')
    expect(serializeMapState({
      datePreset: 'all',
      pickedUpFilter: 'all',
      myFilter: false,
      heatMetric: 'items',
    }).toString()).toBe('')
  })

  test('encodes non-default filters', () => {
    const params = serializeMapState({
      datePreset: '30d',
      pickedUpFilter: 'picked',
      myFilter: true,
      heatMetric: 'mass',
    })
    expect(params.get('since')).toBe('30d')
    expect(params.get('picked')).toBe('picked')
    expect(params.get('mine')).toBe('1')
    expect(params.get('metric')).toBe('mass')
  })

  test('encodes cleanup filter (kind: cleanup)', () => {
    const params = serializeMapState({
      cleanupFilter: {
        kind: 'cleanup',
        cleanupId: '019e4977-e7f5-77e3-86fa-9890ac84d47d',
        cleanupName: 'Beach Day',
      },
    })
    expect(params.get('cleanup')).toBe('019e4977-e7f5-77e3-86fa-9890ac84d47d')
    expect(params.get('cleanupDate')).toBeNull()
  })

  test('encodes cleanup filter (kind: date)', () => {
    const params = serializeMapState({
      cleanupFilter: {
        kind: 'date',
        cleanupId: '019e4977-e7f5-77e3-86fa-9890ac84d47d',
        cleanupDateId: '019d082d-f381-72c1-8de2-04d19b40630c',
        cleanupName: 'Beach Day',
      },
    })
    expect(params.get('cleanup')).toBe('019e4977-e7f5-77e3-86fa-9890ac84d47d')
    expect(params.get('cleanupDate')).toBe('019d082d-f381-72c1-8de2-04d19b40630c')
  })

  test('rounds view coordinates', () => {
    const params = serializeMapState({
      view: { lon: 8.5419123, lat: 47.3768866, zoom: 13.421 },
    })
    expect(params.get('view')).toBe('8.542,47.377,13.42')
  })
})

describe('parseMapState', () => {
  test('returns empty object for empty params', () => {
    expect(parseMapState(new URLSearchParams())).toEqual({})
  })

  test('parses valid filters', () => {
    const params = new URLSearchParams('since=7d&picked=spotted&mine=1&metric=mass')
    expect(parseMapState(params)).toEqual({
      datePreset: '7d',
      pickedUpFilter: 'spotted',
      myFilter: true,
      heatMetric: 'mass',
    })
  })

  test('drops invalid filter values', () => {
    const params = new URLSearchParams('since=bogus&picked=invalid&metric=xxx')
    expect(parseMapState(params)).toEqual({})
  })

  test('parses cleanup filter (kind: cleanup) when only cleanup id present', () => {
    const params = new URLSearchParams('cleanup=019e4977-e7f5-77e3-86fa-9890ac84d47d')
    const parsed = parseMapState(params)
    expect(parsed.cleanupFilter).toEqual({
      kind: 'cleanup',
      cleanupId: '019e4977-e7f5-77e3-86fa-9890ac84d47d',
      cleanupName: '',
    })
  })

  test('parses cleanup filter (kind: date) when both ids present', () => {
    const params = new URLSearchParams('cleanup=019e4977-e7f5-77e3-86fa-9890ac84d47d&cleanupDate=019d082d-f381-72c1-8de2-04d19b40630c')
    const parsed = parseMapState(params)
    expect(parsed.cleanupFilter).toEqual({
      kind: 'date',
      cleanupId: '019e4977-e7f5-77e3-86fa-9890ac84d47d',
      cleanupDateId: '019d082d-f381-72c1-8de2-04d19b40630c',
      cleanupName: '',
    })
  })

  test('drops non-uuid cleanup ids', () => {
    expect(parseMapState(new URLSearchParams('cleanup=not-a-uuid')).cleanupFilter).toBeUndefined()
  })

  test('parses valid view', () => {
    expect(parseMapState(new URLSearchParams('view=8.542,47.377,13.42')).view).toEqual({
      lon: 8.542,
      lat: 47.377,
      zoom: 13.42,
    })
  })

  test('drops view with out-of-range coordinates', () => {
    expect(parseMapState(new URLSearchParams('view=200,0,5')).view).toBeUndefined()
    expect(parseMapState(new URLSearchParams('view=0,100,5')).view).toBeUndefined()
    expect(parseMapState(new URLSearchParams('view=0,0,99')).view).toBeUndefined()
    expect(parseMapState(new URLSearchParams('view=junk')).view).toBeUndefined()
  })
})

describe('round-trip', () => {
  test('serialize → parse preserves filters', () => {
    const original = {
      datePreset: '30d' as const,
      pickedUpFilter: 'picked' as const,
      myFilter: true,
      heatMetric: 'mass' as const,
      view: { lon: 8.5, lat: 47.4, zoom: 12 },
    }
    const params = serializeMapState(original)
    const parsed = parseMapState(params)
    expect(parsed.datePreset).toBe(original.datePreset)
    expect(parsed.pickedUpFilter).toBe(original.pickedUpFilter)
    expect(parsed.myFilter).toBe(true)
    expect(parsed.heatMetric).toBe(original.heatMetric)
    expect(parsed.view).toEqual({ lon: 8.5, lat: 47.4, zoom: 12 })
  })
})
