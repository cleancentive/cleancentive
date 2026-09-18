import { describe, expect, test } from 'bun:test'
import { markdownPreview } from './markdownPreview'

describe('markdownPreview', () => {
  test('a link reads as its text, not its syntax', () => {
    expect(markdownPreview('Treffpunkt: [Gondelbahn](https://maps.app.goo.gl/oVvS)')).toBe('Treffpunkt: Gondelbahn')
  })

  test('an autolink keeps the address', () => {
    expect(markdownPreview('Anmeldung: <https://example.org/form>')).toBe('Anmeldung: https://example.org/form')
  })

  test('emphasis and headings lose their marks', () => {
    expect(markdownPreview('### Programm\n\n**Treffpunkt:** *Kirchplatz*')).toBe('Programm Treffpunkt: Kirchplatz')
  })

  test('a list becomes a single flowing line', () => {
    expect(markdownPreview('- Handschuhe\n- Picknick')).toBe('Handschuhe Picknick')
  })

  test('escaped characters read as themselves', () => {
    expect(markdownPreview('Kosten: 5\\*4 Franken')).toBe('Kosten: 5*4 Franken')
  })

  test('an image is dropped rather than shown as syntax', () => {
    expect(markdownPreview('vorher ![alt](https://x/y.png) nachher')).toBe('vorher nachher')
  })

  test('plain text passes through', () => {
    expect(markdownPreview('Ein ganz normaler Text.')).toBe('Ein ganz normaler Text.')
  })
})
