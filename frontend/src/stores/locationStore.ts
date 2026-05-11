import { create } from 'zustand'

const PEDESTRIAN_MAX_M_PER_S = 3
const GAP_BYPASS_SECONDS = 60
const BUFFER_MAX = 10
const BUFFER_MAX_AGE_MS = 60_000
const ACCURACY_OUTLIER_MULTIPLIER = 5

export interface LocationFix {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}

interface CaptureWindowState {
  startedAt: number
  buffer: LocationFix[]
  rejectedCount: number
}

interface LocationState {
  permissionDenied: boolean
  notSupported: boolean
  errorMessage: string | null
  latest: LocationFix | null
  captureWindow: CaptureWindowState | null
  bestRecent: LocationFix | null
  openCaptureWindow: () => void
  closeCaptureWindow: () => void
}

function haversineMeters(a: LocationFix, b: LocationFix): number {
  const earthRadius = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadius * Math.asin(Math.sqrt(h))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function shouldAccept(fix: LocationFix, buffer: LocationFix[]): boolean {
  if (buffer.length === 0) return true
  const previous = buffer[buffer.length - 1]
  const dtSec = (fix.timestamp - previous.timestamp) / 1000
  // Signal-loss recovery: long gap (tunnel, cable car) — accept as fresh anchor.
  if (dtSec >= GAP_BYPASS_SECONDS) return true
  if (dtSec <= 0) return false
  const distance = haversineMeters(previous, fix)
  const impliedSpeed = distance / dtSec
  if (impliedSpeed > PEDESTRIAN_MAX_M_PER_S) return false
  const recentAccuracies = buffer.slice(-10).map((f) => f.accuracy)
  const med = median(recentAccuracies)
  if (med > 0 && fix.accuracy > med * ACCURACY_OUTLIER_MULTIPLIER) return false
  return true
}

function selectBest(buffer: LocationFix[], now: number): LocationFix | null {
  const fresh = buffer.filter((f) => now - f.timestamp <= BUFFER_MAX_AGE_MS)
  if (fresh.length === 0) return null
  return fresh.reduce((best, f) => (f.accuracy < best.accuracy ? f : best))
}

export const useLocationStore = create<LocationState>(() => ({
  permissionDenied: false,
  notSupported: false,
  errorMessage: null,
  latest: null,
  captureWindow: null,
  bestRecent: null,
  openCaptureWindow: () => {
    useLocationStore.setState({
      captureWindow: { startedAt: Date.now(), buffer: [], rejectedCount: 0 },
      bestRecent: null,
    })
  },
  closeCaptureWindow: () => {
    useLocationStore.setState({ captureWindow: null, bestRecent: null })
  },
}))

function ingestFix(fix: LocationFix) {
  const state = useLocationStore.getState()
  const window = state.captureWindow

  const update: Partial<LocationState> = { latest: fix, errorMessage: null }

  if (window) {
    if (shouldAccept(fix, window.buffer)) {
      const newBuffer = [...window.buffer, fix].slice(-BUFFER_MAX)
      update.captureWindow = { ...window, buffer: newBuffer }
      update.bestRecent = selectBest(newBuffer, fix.timestamp)
    } else {
      update.captureWindow = { ...window, rejectedCount: window.rejectedCount + 1 }
    }
  }

  useLocationStore.setState(update)
}

if (typeof window !== 'undefined') {
  if (!navigator.geolocation) {
    useLocationStore.setState({
      notSupported: true,
      errorMessage: 'Geolocation is not supported in this browser.',
    })
  } else {
    const startWatch = () => {
      navigator.geolocation.watchPosition(
        (position) => {
          ingestFix({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: Date.now(),
          })
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            useLocationStore.setState({
              permissionDenied: true,
              errorMessage: 'Location access was denied. Enable it in your browser site settings.',
            })
          } else {
            useLocationStore.setState({ errorMessage: error.message })
          }
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
      )
    }

    if (navigator.permissions) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((result) => {
          if (result.state === 'denied') {
            useLocationStore.setState({
              permissionDenied: true,
              errorMessage: 'Location access was denied. Enable it in your browser site settings.',
            })
            return
          }
          startWatch()
          result.onchange = () => {
            if (result.state === 'denied') {
              useLocationStore.setState({
                permissionDenied: true,
                errorMessage: 'Location access was denied. Enable it in your browser site settings.',
              })
            }
          }
        })
        .catch(() => startWatch())
    } else {
      startWatch()
    }
  }
}
