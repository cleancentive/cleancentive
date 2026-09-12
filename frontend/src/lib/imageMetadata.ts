import exifr from 'exifr'

export type LocationMissingReason =
  | 'unsupported-format'
  | 'unreadable'
  | 'no-gps'
  | 'invalid-gps'

interface ImageTimestamps {
  capturedAt: string | null
  accuracyMeters: number | null
}

export type ImageMetadata =
  | (ImageTimestamps & { status: 'located'; latitude: number; longitude: number })
  | (ImageTimestamps & { status: 'unlocated'; reason: LocationMissingReason })

export type CoordinateClassification =
  | { status: 'located'; latitude: number; longitude: number }
  | { status: 'unlocated'; reason: 'no-gps' | 'invalid-gps' }

// Formats that are known to carry EXIF. This is only a hint for choosing the
// failure reason — it is not a gate. Anything may be handed to exifr; a file it
// cannot parse is reported, never rejected outright.
const EXIF_BEARING_EXTENSIONS = /\.(jpe?g|heic|heif|avif|tiff?|webp|dng)$/i
const EXIF_BEARING_MIME_TYPES = new Set([
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

function mayCarryExif(file: File): boolean {
  if (file.type && EXIF_BEARING_MIME_TYPES.has(file.type.toLowerCase())) return true
  return EXIF_BEARING_EXTENSIONS.test(file.name)
}

export function classifyCoordinates(latitude: unknown, longitude: unknown): CoordinateClassification {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { status: 'unlocated', reason: 'no-gps' }
  }

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (latitude === 0 && longitude === 0) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return { status: 'unlocated', reason: 'invalid-gps' }
  }

  return { status: 'located', latitude, longitude }
}

function readCapturedAt(parsed: Record<string, unknown> | undefined): string | null {
  const dateTimeOriginal = parsed?.DateTimeOriginal
  if (dateTimeOriginal instanceof Date && !Number.isNaN(dateTimeOriginal.getTime())) {
    return dateTimeOriginal.toISOString()
  }
  return null
}

function readAccuracyMeters(parsed: Record<string, unknown> | undefined): number | null {
  const reportedAccuracy = parsed?.GPSHPositioningError
  if (typeof reportedAccuracy === 'number' && Number.isFinite(reportedAccuracy) && reportedAccuracy > 0) {
    return reportedAccuracy
  }
  return null
}

/**
 * Describes what we could learn about a photo. Never rejects: a file we cannot
 * place still comes back with its reason and whatever timestamp it carries, so
 * the caller can keep the photo and ask the user to place it by hand.
 *
 * The 'no-gps' case is routine, not exotic — iOS Safari transcodes Photo Library
 * picks to JPEG and drops the GPS block on the way, so a photo that plainly has
 * coordinates on the phone arrives here with none.
 */
export async function extractImageMetadata(file: File): Promise<ImageMetadata> {
  let parsed: Record<string, unknown> | undefined
  try {
    // Hand exifr the bytes rather than the File: its File path goes through
    // FileReader, which pulls in a browser-only global and makes this
    // impossible to test outside a DOM.
    const bytes = await file.arrayBuffer()
    parsed = (await exifr.parse(bytes, {
      gps: true,
      exif: { pick: ['DateTimeOriginal'] },
    })) as Record<string, unknown> | undefined
  } catch {
    return {
      status: 'unlocated',
      reason: mayCarryExif(file) ? 'unreadable' : 'unsupported-format',
      capturedAt: null,
      accuracyMeters: null,
    }
  }

  // Read the timestamp before the coordinates: a photo that lost its GPS may
  // still know when it was taken, and that is worth keeping.
  const capturedAt = readCapturedAt(parsed)
  const accuracyMeters = readAccuracyMeters(parsed)

  return { ...classifyCoordinates(parsed?.latitude, parsed?.longitude), capturedAt, accuracyMeters }
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
