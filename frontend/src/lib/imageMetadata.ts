import exifr from 'exifr'

export interface ImageMetadata {
  latitude: number
  longitude: number
  capturedAt: string | null
  accuracyMeters: number | null
}

const SUPPORTED_EXTENSIONS = /\.(jpe?g|heic|heif|avif|tiff?|webp|dng)$/i
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'image/avif',
  'image/tiff',
  'image/webp',
  'image/dng',
  'image/x-adobe-dng',
])

function isSupportedFile(file: File): boolean {
  if (file.type && SUPPORTED_MIME_TYPES.has(file.type.toLowerCase())) return true
  return SUPPORTED_EXTENSIONS.test(file.name)
}

export async function extractImageMetadata(file: File): Promise<ImageMetadata> {
  if (!isSupportedFile(file)) {
    throw new Error('This file format is not supported. Try JPEG or HEIC.')
  }

  let parsed: Record<string, unknown> | undefined
  try {
    parsed = (await exifr.parse(file, {
      gps: true,
      exif: { pick: ['DateTimeOriginal'] },
    })) as Record<string, unknown> | undefined
  } catch {
    throw new Error('Could not read photo metadata. The file may be corrupted.')
  }

  const latitude = parsed?.latitude
  const longitude = parsed?.longitude

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('This photo has no GPS metadata. Enable Location in your camera app and try again.')
  }

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (latitude === 0 && longitude === 0) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error('GPS coordinates in this photo are invalid.')
  }

  let capturedAt: string | null = null
  const dateTimeOriginal = parsed?.DateTimeOriginal
  if (dateTimeOriginal instanceof Date && !Number.isNaN(dateTimeOriginal.getTime())) {
    capturedAt = dateTimeOriginal.toISOString()
  }

  let accuracyMeters: number | null = null
  const reportedAccuracy = parsed?.GPSHPositioningError
  if (typeof reportedAccuracy === 'number' && Number.isFinite(reportedAccuracy) && reportedAccuracy > 0) {
    accuracyMeters = reportedAccuracy
  }

  return { latitude, longitude, capturedAt, accuracyMeters }
}

const FILENAME_DATE_PATTERNS: Array<{ regex: RegExp; parse: (m: RegExpMatchArray) => Date | null }> = [
  {
    // IMG_20240315_143022, PXL_20240315_143022, Screenshot_20240315-143022
    regex: /(?:IMG|PXL|Screenshot)[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/,
    parse: (m) => new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
  },
  {
    // 20240315_143022
    regex: /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/,
    parse: (m) => new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
  },
  {
    // 2024-03-15_14-30-22 or 2024-03-15 14-30-22
    regex: /(\d{4})-(\d{2})-(\d{2})[_ ](\d{2})-(\d{2})-(\d{2})/,
    parse: (m) => new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
  },
]

export function extractTimestampFromFilename(filename: string): string | null {
  for (const { regex, parse } of FILENAME_DATE_PATTERNS) {
    const match = filename.match(regex)
    if (match) {
      const date = parse(match)
      if (date && !isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
        return date.toISOString()
      }
    }
  }
  return null
}
