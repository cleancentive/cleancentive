export interface CleanupDateInfo {
  cleanupDateId: string
  cleanupId: string
  cleanupName: string
  startAt: string
  endAt: string
  latitude: number
  longitude: number
  locationName: string | null
}

export interface ImportedPhoto {
  file: File
  capturedAt: string | null
  latitude: number | null
  longitude: number | null
  accuracyMeters: number | null
}

export interface MatchResult {
  photo: ImportedPhoto
  bestMatch: CleanupDateInfo | null
  alternatives: CleanupDateInfo[]
  confidence: 'time-and-location' | 'time-only' | 'none'
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => d * (Math.PI / 180)
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findTimeMatches(capturedAt: string, cleanupDates: CleanupDateInfo[]): CleanupDateInfo[] {
  const ts = new Date(capturedAt).getTime()
  if (isNaN(ts)) return []

  return cleanupDates.filter((cd) => {
    const start = new Date(cd.startAt).getTime()
    const end = new Date(cd.endAt).getTime()
    return ts >= start && ts <= end
  })
}

export function matchPhotosToCleanups(
  photos: ImportedPhoto[],
  cleanupDates: CleanupDateInfo[],
): MatchResult[] {
  return photos.map((photo) => {
    if (!photo.capturedAt) {
      return { photo, bestMatch: null, alternatives: [], confidence: 'none' as const }
    }

    const timeMatches = findTimeMatches(photo.capturedAt, cleanupDates)

    if (timeMatches.length === 0) {
      return { photo, bestMatch: null, alternatives: [], confidence: 'none' as const }
    }

    if (timeMatches.length === 1) {
      const hasGps = photo.latitude != null && photo.longitude != null
      return {
        photo,
        bestMatch: timeMatches[0],
        alternatives: [],
        confidence: hasGps ? 'time-and-location' : 'time-only',
      }
    }

    // Multiple matches — rank by distance if GPS available
    if (photo.latitude != null && photo.longitude != null) {
      const lat = photo.latitude
      const lon = photo.longitude
      const sorted = [...timeMatches].sort(
        (a, b) => haversineKm(lat, lon, a.latitude, a.longitude) - haversineKm(lat, lon, b.latitude, b.longitude),
      )
      return {
        photo,
        bestMatch: sorted[0],
        alternatives: sorted.slice(1),
        confidence: 'time-and-location',
      }
    }

    return {
      photo,
      bestMatch: timeMatches[0],
      alternatives: timeMatches.slice(1),
      confidence: 'time-only',
    }
  })
}

export interface ImportGroup {
  key: string
  cleanupDate: CleanupDateInfo | null
  label: string
  items: MatchResult[]
}

export function groupMatchResults(results: MatchResult[]): ImportGroup[] {
  const groups = new Map<string, ImportGroup>()

  for (const result of results) {
    const cd = result.bestMatch
    const key = cd ? cd.cleanupDateId : '__no_match__'

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        cleanupDate: cd,
        label: cd
          ? `${cd.cleanupName} — ${new Date(cd.startAt).toLocaleDateString()}`
          : 'No cleanup match',
        items: [],
      })
    }

    groups.get(key)!.items.push(result)
  }

  // Sort: matched groups first (by date desc), then unmatched
  const sorted = [...groups.values()].sort((a, b) => {
    if (!a.cleanupDate && b.cleanupDate) return 1
    if (a.cleanupDate && !b.cleanupDate) return -1
    if (a.cleanupDate && b.cleanupDate) {
      return new Date(b.cleanupDate.startAt).getTime() - new Date(a.cleanupDate.startAt).getTime()
    }
    return 0
  })

  return sorted
}
