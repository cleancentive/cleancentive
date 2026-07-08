import { create } from 'zustand'
import { haversineMeters } from '@cleancentive/shared'

const PEDESTRIAN_MAX_M_PER_S = 3
const GAP_BYPASS_SECONDS = 60
const BUFFER_MAX = 10
const BUFFER_MAX_AGE_MS = 60_000
const CAPTURE_LOCATION_MAX_AGE_MS = 60_000
const ACCURACY_OUTLIER_MULTIPLIER = 5
const CONSENT_STORAGE_KEY = 'cc-geo-consent'

// App-wide location consent — a single source of truth shared by every surface
// that uses the device location (capture, pickers, map). The app never fires a
// native geolocation prompt without an explicit in-app gesture; once the browser
// reports the permission as `granted`, location resumes silently everywhere.
//   unknown      — initial state, before we have queried the browser
//   needed       — permission is in the browser's "prompt" state; show our own
//                  priming UI and only request on an explicit user gesture
//   granted       — permission granted; the watch is (or will be) running
//   denied       — permission denied; offer the manual-location fallback
//   unsupported  — no geolocation API in this browser
export type LocationConsent = 'unknown' | 'needed' | 'granted' | 'denied' | 'unsupported'

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
  consent: LocationConsent
  errorMessage: string | null
  latest: LocationFix | null
  captureWindow: CaptureWindowState | null
  bestRecent: LocationFix | null
  openCaptureWindow: () => void
  closeCaptureWindow: () => void
  // User-initiated opt-in: persists consent and starts the shared watch (this is
  // the call that may surface the browser's native permission prompt).
  requestLocation: () => void
  requestFreshLocation: () => Promise<LocationFix | null>
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
  const distance = haversineMeters(previous.latitude, previous.longitude, fix.latitude, fix.longitude)
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

function isFreshFix(fix: LocationFix | null, now: number): fix is LocationFix {
  if (!fix) return false
  return now - fix.timestamp <= CAPTURE_LOCATION_MAX_AGE_MS
}

export function selectFreshCaptureLocation(
  bestRecent: LocationFix | null,
  latest: LocationFix | null,
  now = Date.now(),
): LocationFix | null {
  if (isFreshFix(bestRecent, now)) return bestRecent
  if (isFreshFix(latest, now)) return latest
  return null
}

export function getFreshPositionOptions(): PositionOptions {
  return { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
}

function positionToFix(position: GeolocationPosition): LocationFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp,
  }
}

export const useLocationStore = create<LocationState>(() => ({
  consent: 'unknown',
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
  requestLocation: () => {
    rememberConsent()
    startWatch()
  },
  requestFreshLocation: () => requestFreshLocation(),
}))

function ingestFix(fix: LocationFix) {
  const state = useLocationStore.getState()
  const window = state.captureWindow

  const update: Partial<LocationState> = { latest: fix, errorMessage: null }
  // A successful fix means permission is granted, regardless of how the watch started.
  if (state.consent !== 'granted') update.consent = 'granted'

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

// Persisted opt-in flag — lets browsers without the Permissions API (older Safari)
// remember that the user once chose to share location, so we can resume without
// re-showing our in-app priming UI.
function hasRememberedConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function rememberConsent() {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, '1')
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

function requestFreshLocation(): Promise<LocationFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    useLocationStore.setState({ consent: 'unsupported' })
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const fix = positionToFix(position)
        ingestFix(fix)
        resolve(selectFreshCaptureLocation(fix, null))
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          useLocationStore.setState({ consent: 'denied', errorMessage: null })
        } else {
          useLocationStore.setState({ errorMessage: error.message })
        }
        resolve(null)
      },
      getFreshPositionOptions(),
    )
  })
}

let watchStarted = false

// Starts the single shared geolocation watch. Idempotent; safe to call from any
// surface. This is the call that may surface the browser's native prompt, so it
// must only run after an explicit gesture or when permission is already granted.
function startWatch() {
  if (watchStarted) return
  if (typeof navigator === 'undefined' || !navigator.geolocation) return
  watchStarted = true
  navigator.geolocation.watchPosition(
    (position) => {
      ingestFix(positionToFix(position))
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        useLocationStore.setState({ consent: 'denied', errorMessage: null })
      } else {
        useLocationStore.setState({ errorMessage: error.message })
      }
    },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
  )
}

// Non-prompting init: querying permission state never surfaces the native dialog.
// We only auto-start the watch when the browser already reports `granted` (or the
// user previously opted in on a browser without the Permissions API). Otherwise we
// settle on `needed` and wait for an explicit gesture via requestLocation().
if (typeof window !== 'undefined') {
  if (!navigator.geolocation) {
    useLocationStore.setState({ consent: 'unsupported' })
  } else if (navigator.permissions?.query) {
    const applyPermission = (state: PermissionState) => {
      if (state === 'granted') {
        useLocationStore.setState({ consent: 'granted', errorMessage: null })
        startWatch()
      } else if (state === 'denied') {
        useLocationStore.setState({ consent: 'denied', errorMessage: null })
      } else if (hasRememberedConsent()) {
        // 'prompt' but the user already opted in before — resume on their behalf.
        startWatch()
      } else {
        useLocationStore.setState({ consent: 'needed' })
      }
    }
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        applyPermission(result.state)
        result.onchange = () => applyPermission(result.state)
      })
      .catch(() => {
        if (hasRememberedConsent()) startWatch()
        else useLocationStore.setState({ consent: 'needed' })
      })
  } else if (hasRememberedConsent()) {
    // No Permissions API (older Safari): trust the persisted opt-in.
    startWatch()
  } else {
    useLocationStore.setState({ consent: 'needed' })
  }
}
