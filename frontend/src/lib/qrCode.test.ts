import { describe, expect, test } from 'vitest'

import { buildQrCodeSvg } from './qrCode'

describe('buildQrCodeSvg', () => {
  test('builds a self-contained QR SVG for the instance URL', () => {
    const svg = buildQrCodeSvg('https://cleancentive.example')

    expect(svg).toContain('<svg')
    expect(svg).toContain('<title>QR code for https://cleancentive.example</title>')
    expect(svg).toContain('viewBox="0 0 ')
    expect(svg).toContain('<rect')
    expect(svg).not.toContain('<script')
  })

  test('writes matching QR format information copies', () => {
    const darkModules = parseDarkModules(buildQrCodeSvg('https://cleancentive.example'))
    const size = 33
    const firstFormatPositions = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
    const secondFormatPositions = [[size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8], [size - 8, 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]]

    for (let i = 0; i < firstFormatPositions.length; i += 1) {
      expect(darkModules.has(firstFormatPositions[i].join(','))).toBe(darkModules.has(secondFormatPositions[i].join(',')))
    }
  })
})

function parseDarkModules(svg: string): Set<string> {
  const darkModules = new Set<string>()
  const rectPattern = /<rect x="(\d+)" y="(\d+)" width="1" height="1"\/>/g
  let match = rectPattern.exec(svg)

  while (match) {
    darkModules.add(`${Number(match[1]) - 4},${Number(match[2]) - 4}`)
    match = rectPattern.exec(svg)
  }

  return darkModules
}
