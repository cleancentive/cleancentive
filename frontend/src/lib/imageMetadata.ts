export interface ImageMetadata {
  latitude: number
  longitude: number
  capturedAt: string | null
  accuracyMeters: number | null
}

interface IfdEntry {
  tag: number
  type: number
  count: number
  entryOffset: number
}

const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
}

function toAscii(view: DataView, offset: number, count: number): string {
  let result = ''

  for (let index = 0; index < count; index += 1) {
    const code = view.getUint8(offset + index)
    if (code === 0) {
      break
    }
    result += String.fromCharCode(code)
  }

  return result
}

function getDataOffset(view: DataView, entry: IfdEntry, tiffStart: number, littleEndian: boolean): number {
  const unitSize = TIFF_TYPE_SIZES[entry.type]
  if (!unitSize) {
    throw new Error('Unsupported EXIF field type')
  }

  const byteCount = unitSize * entry.count
  if (byteCount <= 4) {
    return entry.entryOffset + 8
  }

  const relativeOffset = view.getUint32(entry.entryOffset + 8, littleEndian)
  return tiffStart + relativeOffset
}

function readIfd(view: DataView, ifdOffset: number, littleEndian: boolean): IfdEntry[] {
  if (ifdOffset < 0 || ifdOffset + 2 > view.byteLength) {
    throw new Error('Invalid EXIF IFD offset')
  }

  const entryCount = view.getUint16(ifdOffset, littleEndian)
  const entries: IfdEntry[] = []

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (entryOffset + 12 > view.byteLength) {
      throw new Error('Invalid EXIF entry boundary')
    }

    entries.push({
      tag: view.getUint16(entryOffset, littleEndian),
      type: view.getUint16(entryOffset + 2, littleEndian),
      count: view.getUint32(entryOffset + 4, littleEndian),
      entryOffset,
    })
  }

  return entries
}

function findEntry(entries: IfdEntry[], tag: number): IfdEntry | null {
  return entries.find((entry) => entry.tag === tag) || null
}

function readRational(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (offset + 8 > view.byteLength) {
    return null
  }

  const numerator = view.getUint32(offset, littleEndian)
  const denominator = view.getUint32(offset + 4, littleEndian)
  if (denominator === 0) {
    return null
  }

  return numerator / denominator
}

function readRationalTriplet(
  view: DataView,
  entry: IfdEntry,
  tiffStart: number,
  littleEndian: boolean,
): [number, number, number] | null {
  if (entry.type !== 5 || entry.count < 3) {
    return null
  }

  const dataOffset = getDataOffset(view, entry, tiffStart, littleEndian)
  const degree = readRational(view, dataOffset, littleEndian)
  const minute = readRational(view, dataOffset + 8, littleEndian)
  const second = readRational(view, dataOffset + 16, littleEndian)

  if (degree === null || minute === null || second === null) {
    return null
  }

  return [degree, minute, second]
}

function readAsciiValue(view: DataView, entry: IfdEntry, tiffStart: number, littleEndian: boolean): string | null {
  if (entry.type !== 2 || entry.count === 0) {
    return null
  }

  const dataOffset = getDataOffset(view, entry, tiffStart, littleEndian)
  if (dataOffset + entry.count > view.byteLength) {
    return null
  }

  const value = toAscii(view, dataOffset, entry.count).trim()
  return value.length > 0 ? value : null
}

function toCoordinate(triplet: [number, number, number], reference: string): number {
  const decimal = triplet[0] + triplet[1] / 60 + triplet[2] / 3600
  if (reference === 'S' || reference === 'W') {
    return -decimal
  }

  return decimal
}

function parseExifDateTime(value: string | null): string | null {
  if (!value) {
    return null
  }

  const match = value.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])

  const parsed = new Date(year, month, day, hour, minute, second)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
}

function findExifApp1Offset(view: DataView): number | null {
  if (view.byteLength < 4) {
    return null
  }

  if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1
      continue
    }

    const marker = view.getUint8(offset + 1)
    if (marker === 0xda || marker === 0xd9) {
      break
    }

    if (offset + 4 > view.byteLength) {
      break
    }

    const segmentLength = view.getUint16(offset + 2, false)
    if (segmentLength < 2) {
      break
    }

    const segmentStart = offset + 4
    const segmentEnd = offset + 2 + segmentLength
    if (segmentEnd > view.byteLength) {
      break
    }

    if (marker === 0xe1 && segmentStart + 6 <= segmentEnd) {
      const signature = toAscii(view, segmentStart, 6)
      if (signature === 'Exif') {
        return segmentStart + 6
      }
    }

    offset = segmentEnd
  }

  return null
}

export async function extractImageMetadata(file: File): Promise<ImageMetadata> {
  const arrayBuffer = await file.arrayBuffer()
  const view = new DataView(arrayBuffer)

  const tiffStart = findExifApp1Offset(view)
  if (tiffStart === null) {
    throw new Error('File import requires EXIF GPS metadata (JPEG with location tags).')
  }

  const byteOrder = toAscii(view, tiffStart, 2)
  const littleEndian = byteOrder === 'II'
  if (!littleEndian && byteOrder !== 'MM') {
    throw new Error('Unsupported EXIF byte order')
  }

  const tiffMarker = view.getUint16(tiffStart + 2, littleEndian)
  if (tiffMarker !== 42) {
    throw new Error('Invalid EXIF TIFF header')
  }

  const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, littleEndian)
  const ifd0Entries = readIfd(view, ifd0Offset, littleEndian)

  const gpsPointerEntry = findEntry(ifd0Entries, 0x8825)
  if (!gpsPointerEntry) {
    throw new Error('File import requires EXIF GPS metadata. No location tag found.')
  }

  const gpsIfdOffset = tiffStart + view.getUint32(gpsPointerEntry.entryOffset + 8, littleEndian)
  const gpsEntries = readIfd(view, gpsIfdOffset, littleEndian)

  const latitudeRefEntry = findEntry(gpsEntries, 0x0001)
  const latitudeEntry = findEntry(gpsEntries, 0x0002)
  const longitudeRefEntry = findEntry(gpsEntries, 0x0003)
  const longitudeEntry = findEntry(gpsEntries, 0x0004)

  const latitudeRef = latitudeRefEntry
    ? readAsciiValue(view, latitudeRefEntry, tiffStart, littleEndian)
    : null
  const longitudeRef = longitudeRefEntry
    ? readAsciiValue(view, longitudeRefEntry, tiffStart, littleEndian)
    : null

  if (!latitudeRef || !longitudeRef || !latitudeEntry || !longitudeEntry) {
    throw new Error('File import requires EXIF GPS latitude/longitude tags.')
  }

  const latitudeTriplet = readRationalTriplet(view, latitudeEntry, tiffStart, littleEndian)
  const longitudeTriplet = readRationalTriplet(view, longitudeEntry, tiffStart, littleEndian)

  if (!latitudeTriplet || !longitudeTriplet) {
    throw new Error('File import requires valid EXIF GPS coordinate values.')
  }

  const latitude = toCoordinate(latitudeTriplet, latitudeRef)
  const longitude = toCoordinate(longitudeTriplet, longitudeRef)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('File import EXIF location is invalid.')
  }

  let capturedAt: string | null = null
  const exifPointerEntry = findEntry(ifd0Entries, 0x8769)
  if (exifPointerEntry) {
    const exifIfdOffset = tiffStart + view.getUint32(exifPointerEntry.entryOffset + 8, littleEndian)
    const exifEntries = readIfd(view, exifIfdOffset, littleEndian)
    const dateEntry = findEntry(exifEntries, 0x9003)
    if (dateEntry) {
      capturedAt = parseExifDateTime(readAsciiValue(view, dateEntry, tiffStart, littleEndian))
    }
  }

  let accuracyMeters: number | null = null
  const horizontalErrorEntry = findEntry(gpsEntries, 0x001f)
  if (horizontalErrorEntry && horizontalErrorEntry.type === 5 && horizontalErrorEntry.count >= 1) {
    const accuracyOffset = getDataOffset(view, horizontalErrorEntry, tiffStart, littleEndian)
    accuracyMeters = readRational(view, accuracyOffset, littleEndian)
  }

  return {
    latitude,
    longitude,
    capturedAt,
    accuracyMeters,
  }
}
