import { describe, test, expect } from 'bun:test'
import { classifyCoordinates, extractImageMetadata, extractTimestampFromFilename } from './imageMetadata'

async function fixture(name: string, type = 'image/jpeg'): Promise<File> {
  const bytes = await Bun.file(`${import.meta.dir}/__fixtures__/${name}`).arrayBuffer()
  return new File([bytes], name, { type })
}

describe('extractImageMetadata', () => {
  test('reads coordinates, timestamp and accuracy from a GPS-tagged photo', async () => {
    const result = await extractImageMetadata(await fixture('gps-tagged.jpg'))

    expect(result.status).toBe('located')
    if (result.status !== 'located') throw new Error('unreachable')
    expect(result.latitude).toBeCloseTo(47.3769, 4)
    expect(result.longitude).toBeCloseTo(8.5417, 4)
    expect(result.accuracyMeters).toBe(12)
    expect(result.capturedAt).toBe(new Date(2026, 2, 15, 14, 30, 22).toISOString())
  })

  // The reported bug: iOS Safari transcodes Photo Library picks and drops the GPS
  // block, keeping the rest of the EXIF. Such a photo must stay importable, and it
  // must not lose its capture time along with its coordinates.
  test('keeps the capture time of a photo whose GPS block was stripped', async () => {
    const result = await extractImageMetadata(await fixture('gps-stripped.jpg'))

    expect(result.status).toBe('unlocated')
    if (result.status !== 'unlocated') throw new Error('unreachable')
    expect(result.reason).toBe('no-gps')
    expect(result.capturedAt).toBe(new Date(2026, 2, 15, 14, 30, 22).toISOString())
  })

  test('describes a non-image instead of rejecting', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' })
    const result = await extractImageMetadata(file)

    expect(result.status).toBe('unlocated')
    if (result.status !== 'unlocated') throw new Error('unreachable')
    expect(result.reason).toBe('unsupported-format')
  })

  // PNG is absent from the MIME/extension allow-list, so screenshots used to be
  // turned away as an unsupported format before exifr ever looked at them.
  test('accepts a PNG and reports it as merely unlocated', async () => {
    const png = await Bun.file(`${import.meta.dir}/__fixtures__/no-exif.png`).arrayBuffer()
    const result = await extractImageMetadata(new File([png], 'Screenshot.png', { type: 'image/png' }))

    expect(result.status).toBe('unlocated')
    if (result.status !== 'unlocated') throw new Error('unreachable')
    expect(result.reason).toBe('no-gps')
  })
})

describe('classifyCoordinates', () => {
  test('accepts a real coordinate pair', () => {
    expect(classifyCoordinates(47.3769, 8.5417)).toEqual({
      status: 'located',
      latitude: 47.3769,
      longitude: 8.5417,
    })
  })

  test('treats absent or non-numeric coordinates as no-gps', () => {
    expect(classifyCoordinates(undefined, undefined)).toEqual({ status: 'unlocated', reason: 'no-gps' })
    expect(classifyCoordinates('47.3', '8.5')).toEqual({ status: 'unlocated', reason: 'no-gps' })
    expect(classifyCoordinates(47.3, undefined)).toEqual({ status: 'unlocated', reason: 'no-gps' })
  })

  test('treats null island, out-of-range and non-finite pairs as invalid-gps', () => {
    expect(classifyCoordinates(0, 0)).toEqual({ status: 'unlocated', reason: 'invalid-gps' })
    expect(classifyCoordinates(91, 8)).toEqual({ status: 'unlocated', reason: 'invalid-gps' })
    expect(classifyCoordinates(47, 181)).toEqual({ status: 'unlocated', reason: 'invalid-gps' })
    expect(classifyCoordinates(NaN, 8)).toEqual({ status: 'unlocated', reason: 'invalid-gps' })
    expect(classifyCoordinates(47, Infinity)).toEqual({ status: 'unlocated', reason: 'invalid-gps' })
  })
})

describe('extractTimestampFromFilename', () => {
  test('parses the camera filename patterns', () => {
    const expected = new Date(2024, 2, 15, 14, 30, 22).toISOString()
    expect(extractTimestampFromFilename('IMG_20240315_143022.jpg')).toBe(expected)
    expect(extractTimestampFromFilename('PXL_20240315_143022.jpg')).toBe(expected)
    expect(extractTimestampFromFilename('20240315_143022.jpg')).toBe(expected)
    expect(extractTimestampFromFilename('2024-03-15_14-30-22.jpg')).toBe(expected)
  })

  test('returns null for filenames without a plausible date', () => {
    expect(extractTimestampFromFilename('photo.jpg')).toBeNull()
    expect(extractTimestampFromFilename('IMG_18990101_000000.jpg')).toBeNull()
  })
})
