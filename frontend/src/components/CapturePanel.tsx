import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useCleanupStore } from '../stores/cleanupStore'
import { useLocationStore } from '../stores/locationStore'
import { cancelScheduledFlush, flushOutbox, queueCapture } from '../lib/pendingPicks'
import { extractImageMetadata } from '../lib/imageMetadata'
import { trackEvent } from '../lib/analytics'
import { createBlobFromCanvas, createThumbnailFromCanvas, createThumbnailFromBlob } from '../lib/thumbnail'
import { BatchImportDialog } from './BatchImportDialog'
import { ManualLocationDialog } from './ManualLocationDialog'

const LOCATION_GOOD_THRESHOLD_METERS = Number(import.meta.env.VITE_LOCATION_GOOD_THRESHOLD_METERS || '50')
const LOCATION_WARN_THRESHOLD_METERS = Number(import.meta.env.VITE_LOCATION_WARN_THRESHOLD_METERS || '500')
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])
const IS_LOCALHOST =
  typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname)
const AUTO_ACCEPT_LOW_CONFIDENCE =
  IS_LOCALHOST ||
  (import.meta.env.DEV &&
    String(import.meta.env.VITE_DISABLE_LOCATION_ACCURACY_CHECK || 'false').toLowerCase() === 'true')
import { API_BASE } from '../lib/apiBase'

type LocationTier = 'unknown' | 'good' | 'warning' | 'low'

function classifyAccuracy(accuracy: number): LocationTier {
  if (accuracy <= LOCATION_GOOD_THRESHOLD_METERS) return 'good'
  if (accuracy <= LOCATION_WARN_THRESHOLD_METERS) return 'warning'
  return 'low'
}

function notifyPicksChanged() {
  window.dispatchEvent(new Event('picks-changed'))
}

export function CapturePanel() {
  const { user, sessionToken, guestId } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const { cleanups, activateDate: activateCleanupDate } = useCleanupStore()

  const ongoingCleanup = useMemo(() => {
    if (!user || user.active_cleanup_date_id) return null
    const now = Date.now()
    const ongoing = cleanups.find(c =>
      c.userRole !== null &&
      c.nearestDate &&
      new Date(c.nearestDate.start_at).getTime() <= now &&
      new Date(c.nearestDate.end_at).getTime() >= now,
    )
    return ongoing ? { name: ongoing.cleanup.name, dateId: ongoing.nearestDate!.id } : null
  }, [cleanups, user, user?.active_cleanup_date_id])
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [isImportingFile, setIsImportingFile] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [showLocationDetail, setShowLocationDetail] = useState(false)
  const [pickedUp, setPickedUp] = useState(true)
  const [pendingSubject, setPendingSubject] = useState<'litter' | 'plant'>('litter')
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null)
  const [manualLocation, setManualLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [showManualPicker, setShowManualPicker] = useState(false)

  const latestLocation = useLocationStore((s) => s.latest)
  const bestRecentLocation = useLocationStore((s) => s.bestRecent)
  const locationError = useLocationStore((s) => s.errorMessage)
  const openCaptureWindow = useLocationStore((s) => s.openCaptureWindow)
  const closeCaptureWindow = useLocationStore((s) => s.closeCaptureWindow)

  // Manual pick (if set) wins; otherwise prefer the filtered best fix; finally fall back to the raw latest fix.
  const gpsLocation = bestRecentLocation ?? latestLocation
  const location = manualLocation
    ? { latitude: manualLocation.latitude, longitude: manualLocation.longitude, accuracy: null as number | null }
    : gpsLocation
      ? { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude, accuracy: gpsLocation.accuracy as number | null }
      : null

  const locationTier: LocationTier | 'manual' = manualLocation
    ? 'manual'
    : location && location.accuracy !== null
      ? classifyAccuracy(location.accuracy)
      : 'unknown'

  useEffect(() => {
    openCaptureWindow()
    return () => closeCaptureWindow()
  }, [openCaptureWindow, closeCaptureWindow])

  const runSync = useCallback(async () => {
    if (!useConnectivityStore.getState().isOnline) {
      cancelScheduledFlush()
      return
    }

    await flushOutbox({
      apiBase: API_BASE,
      sessionToken,
      currentUserId: user?.id || null,
      currentGuestId: guestId,
      isOnline: () => useConnectivityStore.getState().isOnline,
    })
  }, [guestId, sessionToken, user?.id])

  useEffect(() => {
    if (isOnline) {
      void runSync()
    } else {
      cancelScheduledFlush()
    }
  }, [isOnline, runSync])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsCameraActive(false)
  }, [])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  useEffect(() => {
    if (!isCameraActive || !videoRef.current || !streamRef.current) {
      return
    }

    videoRef.current.srcObject = streamRef.current
    void videoRef.current.play().catch(() => {
      // autoplay can be blocked in some browsers until explicit interaction
    })
  }, [isCameraActive])

  const getCameraErrorMessage = (error: unknown): string => {
    if (error && typeof error === 'object' && 'name' in error) {
      const errorName = String((error as { name?: string }).name || '')
      if (errorName === 'NotAllowedError') {
        return 'Camera permission was denied. Please allow camera access in your browser\'s site settings.'
      }
      if (errorName === 'NotFoundError') {
        return 'No camera was found for this browser session.'
      }
      if (errorName === 'NotReadableError') {
        return 'Camera is busy or unavailable. Close other apps using the camera and try again.'
      }
      if (errorName === 'OverconstrainedError') {
        return 'Requested camera constraints are not supported on this device.'
      }
    }

    if (error instanceof Error && error.message) {
      return error.message
    }

    return 'Unable to access camera'
  }

  const startCamera = async () => {
    setCaptureError(null)

    if (typeof navigator === 'undefined') {
      setCaptureError('Camera is unavailable in this environment.')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCaptureError('Camera is not supported in this browser.')
      return
    }

    try {
      let stream: MediaStream

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
          },
        })
      } catch (primaryError) {
        const primaryErrorName =
          primaryError && typeof primaryError === 'object' && 'name' in primaryError
            ? String((primaryError as { name?: string }).name || '')
            : ''

        if (primaryErrorName === 'NotFoundError' || primaryErrorName === 'OverconstrainedError') {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          })
        } else {
          throw primaryError
        }
      }

      streamRef.current = stream

      setIsCameraActive(true)
    } catch (error) {
      setCaptureError(getCameraErrorMessage(error))
    }
  }

  const captureAndQueue = async (subjectKind: 'litter' | 'plant' = 'litter') => {
    if (!videoRef.current || !captureCanvasRef.current) {
      return
    }

    if (!location) {
      setCaptureError('Waiting for a GPS fix. Please wait a few seconds, or set the location manually.')
      return
    }

    if (locationTier === 'low' && location.accuracy !== null && !AUTO_ACCEPT_LOW_CONFIDENCE) {
      const confirmed = window.confirm(
        `GPS confidence is low (±${Math.round(location.accuracy)}m). ` +
          `Save anyway? Your true position is likely within this radius.`,
      )
      if (!confirmed) return
    }

    setIsCapturing(true)
    setCaptureError(null)

    try {
      const video = videoRef.current
      const canvas = captureCanvasRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Failed to capture frame context')
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height)

      const imageBlob = await createBlobFromCanvas(canvas, 'image/jpeg', 0.9)
      const thumbnailBlob = await createThumbnailFromCanvas(canvas)

      await queueCapture({
        ownerUserId: user?.id || null,
        ownerGuestId: guestId,
        capturedAt: new Date().toISOString(),
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracy,
        mimeType: imageBlob.type || 'image/jpeg',
        imageBlob,
        thumbnailBlob,
        pickedUp,
        subjectKind,
      })

      trackEvent('spot-logged', { source: 'camera', pickedUp: pickedUp ? 'true' : 'false', subjectKind })
      setPickedUp(true)
      notifyPicksChanged()

      if (isOnline) {
        await runSync()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to queue capture'
      setCaptureError(message)
    } finally {
      setIsCapturing(false)
    }
  }

  const queueImportedFile = async (file: File, subjectKind: 'litter' | 'plant' = 'litter') => {
    setIsImportingFile(true)
    setCaptureError(null)

    try {
      const metadata = await extractImageMetadata(file)

      const latitude = metadata.latitude
      const longitude = metadata.longitude
      const capturedAt = metadata.capturedAt || new Date(file.lastModified || Date.now()).toISOString()
      const accuracyMeters =
        metadata.accuracyMeters && Number.isFinite(metadata.accuracyMeters) && metadata.accuracyMeters > 0
          ? metadata.accuracyMeters
          : null

      const imageBlob = file
      const thumbnailBlob = await createThumbnailFromBlob(file)

      await queueCapture({
        ownerUserId: user?.id || null,
        ownerGuestId: guestId,
        capturedAt,
        latitude,
        longitude,
        accuracyMeters,
        mimeType: file.type || 'image/jpeg',
        imageBlob,
        thumbnailBlob,
        pickedUp,
        subjectKind,
      })

      trackEvent('spot-logged', { source: 'import', pickedUp: pickedUp ? 'true' : 'false', subjectKind })
      setPickedUp(true)
      notifyPicksChanged()

      if (isOnline) {
        await runSync()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import file'
      setCaptureError(message)
    } finally {
      setIsImportingFile(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files
    if (!selectedFiles || selectedFiles.length === 0) {
      return
    }

    const subject = pendingSubject
    setPendingSubject('litter')

    if (selectedFiles.length === 1) {
      await queueImportedFile(selectedFiles[0], subject)
    } else if (subject === 'plant') {
      // Plant captures are single-shot — batch import is litter-only.
      setCaptureError('Plant captures are single-photo. Pick one file at a time.')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } else {
      setBatchFiles(Array.from(selectedFiles))
    }
  }

  const triggerImport = (subject: 'litter' | 'plant') => {
    setPendingSubject(subject)
    fileInputRef.current?.click()
  }

  const lowConfidenceSuffix = locationTier === 'low' && !AUTO_ACCEPT_LOW_CONFIDENCE ? ' anyway' : ''

  return (
    <fieldset className="page-card capture-panel">
      <legend>{pickedUp ? 'Log a Pick' : 'Log a Spot'}</legend>
      <div className="capture-toolbar">
        <span
          className={`capture-status-pill capture-status-pill--${locationTier === 'unknown' ? 'warning' : locationTier}`}
          onClick={() => setShowLocationDetail(prev => !prev)}
          title="GPS confidence radius — your true location is likely within this distance, not off by it."
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1C4.5 1 3 3 3 5.25 3 8.5 7 13 7 13s4-4.5 4-7.75C11 3 9.5 1 7 1z" /><circle cx="7" cy="5.25" r="1.5" />
          </svg>
          {locationTier === 'manual'
            ? 'Manual'
            : location && location.accuracy !== null
              ? `±${Math.round(location.accuracy)}m`
              : 'Waiting...'}
        </span>
      </div>

      {showLocationDetail && (
        <p className="capture-detail">
          {locationTier === 'manual' && location && (
            <>
              Manual location: {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}.{' '}
              <button className="link-button" onClick={() => setManualLocation(null)}>Use GPS instead</button>
            </>
          )}
          {locationTier === 'good' && location && location.accuracy !== null &&
            `Accuracy: ±${Math.round(location.accuracy)}m`}
          {locationTier === 'warning' && location && location.accuracy !== null &&
            `Accuracy: ±${Math.round(location.accuracy)}m — slight uncertainty`}
          {locationTier === 'low' && location && location.accuracy !== null &&
            `Low GPS confidence: ±${Math.round(location.accuracy)}m. Your true position is likely within this radius.`}
          {locationTier === 'unknown' && 'Waiting for a GPS fix.'}
          {locationTier !== 'manual' && (
            <>
              {' '}
              <button className="link-button" onClick={() => setShowManualPicker(true)}>Set location manually</button>
            </>
          )}
        </p>
      )}

      <div className="camera-wrapper">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInputChange}
          className="file-import-input"
        />

        <div className="camera-actions">
          <button
            className="secondary-button"
            onClick={() => triggerImport('litter')}
            disabled={isImportingFile}
          >
            {isImportingFile ? 'Importing...' : 'Import Photo'}
          </button>
          <button
            className={isCameraActive ? "secondary-button" : "primary-button"}
            onClick={isCameraActive ? stopCamera : startCamera}
          >
            {isCameraActive ? 'Stop Camera' : 'Enable Camera'}
          </button>
        </div>

        {isCameraActive && (
          <>
            <video ref={videoRef} autoPlay muted playsInline className="camera-preview" />
            <div className="camera-actions">
              <button
                className="primary-button"
                onClick={() => captureAndQueue('litter')}
                disabled={isCapturing || locationTier === 'unknown'}
              >
                {isCapturing
                  ? 'Capturing...'
                  : `${pickedUp ? 'Log Pick' : 'Log Spot'}${lowConfidenceSuffix}`}
              </button>
              <button
                className="secondary-button"
                onClick={() => captureAndQueue('plant')}
                disabled={isCapturing || locationTier === 'unknown'}
                title="Identify an invasive plant from this photo"
              >
                {isCapturing ? '...' : `Spot a plant${lowConfidenceSuffix}`}
              </button>
            </div>
            <p className="capture-detail">
              Best plant ID results: close-up of leaf, flower, or whole plant — one species per photo.
            </p>
          </>
        )}

        {!isCameraActive && (
          <p className="capture-plant-import">
            <button
              type="button"
              className="link-button"
              onClick={() => triggerImport('plant')}
              disabled={isImportingFile}
            >
              Or import a photo of an invasive plant
            </button>
          </p>
        )}
        <canvas ref={captureCanvasRef} className="capture-canvas" />
      </div>

      {showManualPicker && (
        <ManualLocationDialog
          initialLatitude={location?.latitude ?? null}
          initialLongitude={location?.longitude ?? null}
          onConfirm={(latitude, longitude) => {
            setManualLocation({ latitude, longitude })
            setShowManualPicker(false)
            setShowLocationDetail(true)
          }}
          onCancel={() => setShowManualPicker(false)}
        />
      )}

      <p className="capture-picked-up-toggle">
        <button className="link-button" onClick={() => setPickedUp(prev => !prev)}>
          {pickedUp ? "Didn\u2019t pick it up?" : 'I picked it up'}
        </button>
      </p>

      {ongoingCleanup && (
        <p className="warning-message">
          "{ongoingCleanup.name}" is ongoing.{' '}
          <button className="link-button" onClick={() => activateCleanupDate(ongoingCleanup.dateId)}>
            Join now! :-)
          </button>
        </p>
      )}
      {locationError && <p className="error-message">Location error: {locationError}</p>}
      {captureError && <p className="error-message">{captureError}</p>}

      {batchFiles && (
        <BatchImportDialog
          files={batchFiles}
          pickedUp={pickedUp}
          onDone={() => {
            setBatchFiles(null)
            if (fileInputRef.current) fileInputRef.current.value = ''
            setPickedUp(true)
            notifyPicksChanged()
            if (isOnline) runSync()
          }}
          onCancel={() => {
            setBatchFiles(null)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
      )}
    </fieldset>
  )
}
