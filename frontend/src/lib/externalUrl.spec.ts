import { describe, expect, test } from 'bun:test'
import { sourceHost } from './externalUrl'

describe('sourceHost', () => {
  test('names the site a cleanup was mirrored from', () => {
    expect(sourceHost('https://cleanuptour.ch/de/event/zermatt/')).toBe('cleanuptour.ch')
  })

  test('drops the www nobody says out loud', () => {
    expect(sourceHost('https://www.example.org/events/1')).toBe('example.org')
  })

  test('keeps a subdomain that carries meaning', () => {
    expect(sourceHost('https://events.example.org/1')).toBe('events.example.org')
  })

  test('falls back to the raw value rather than throwing', () => {
    expect(sourceHost('not a url')).toBe('not a url')
  })
})
