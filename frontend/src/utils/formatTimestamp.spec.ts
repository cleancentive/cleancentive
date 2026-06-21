import { describe, test, expect, beforeAll } from 'vitest'
import i18n from '../i18n'
import { formatTimestamp } from './formatTimestamp'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('formatTimestamp', () => {
  test('handles null/invalid input', () => {
    expect(formatTimestamp(null)).toBe('n/a')
    expect(formatTimestamp(undefined)).toBe('n/a')
    expect(formatTimestamp('not-a-date')).toBe('not-a-date')
  })

  test('renders relative time for recent values in English', async () => {
    await i18n.changeLanguage('en')
    const twoMinAgo = Date.now() - 2 * 60_000
    expect(formatTimestamp(twoMinAgo).toLowerCase()).toContain('minute')
  })

  test('localizes relative time when the locale changes', async () => {
    const twoMinAgo = Date.now() - 2 * 60_000
    await i18n.changeLanguage('de')
    expect(formatTimestamp(twoMinAgo)).toMatch(/Minute/i)
    await i18n.changeLanguage('fr')
    expect(formatTimestamp(twoMinAgo).toLowerCase()).toContain('minute')
    await i18n.changeLanguage('en')
  })

  test('localizes month names for old dates', async () => {
    const old = new Date('2020-01-15T10:00:00Z').getTime()
    await i18n.changeLanguage('fr')
    // French January abbreviation is "janv."
    expect(formatTimestamp(old).toLowerCase()).toContain('janv')
    await i18n.changeLanguage('en')
    expect(formatTimestamp(old)).toContain('Jan')
  })
})
