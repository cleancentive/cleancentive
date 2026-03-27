import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useCleanupStore } from '../stores/cleanupStore'
import { flushOutbox, queueCapture } from '../lib/pendingPicks'
import { extractImageMetadata } from '../lib/imageMetadata'
import { trackEvent } from '../lib/analytics'

const DEFAULT_MAX_LOCATION_ACCURACY_METERS = import.meta.env.DEV ? 5000 : 200
const MAX_LOCATION_ACCURACY_METERS = Number(
  import.meta.env.VITE_LOCATION_MAX_ACCURACY_METERS || DEFAULT_MAX_LOCATION_ACCURACY_METERS,
)
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])
const IS_LOCALHOST =
  typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname)
const DISABLE_LOCATION_ACCURACY_CHECK =
  IS_LOCALHOST ||
  (import.meta.env.DEV &&
    String(import.meta.env.VITE_DISABLE_LOCATION_ACCURACY_CHECK || 'false').toLowerCase() === 'true')
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const IMPORT_DEFAULT_ACCURACY_METERS = Number(import.meta.env.VITE_IMPORT_DEFAULT_ACCURACY_METERS || '200')

interface LocationSnapshot {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}

function createBlobFromCanvas(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to capture image'))
        return
      }
      resolve(blob)
    }, mimeType, quality)
  })
}

async function createThumbnail(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
  const maxDimension = 320
  const width = sourceCanvas.width
  const height = sourceCanvas.height
  const scale = Math.min(1, maxDimension / Math.max(width, height))

  const thumbnailCanvas = document.createElement('canvas')
  thumbnailCanvas.width = Math.max(1, Math.round(width * scale))
  thumbnailCanvas.height = Math.max(1, Math.round(height * scale))

  const context = thumbnailCanvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to create thumbnail context')
  }

  context.drawImage(sourceCanvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height)
  return createBlobFromCanvas(thumbnailCanvas, 'image/jpeg', 0.8)
}

function imageBitmapSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.createImageBitmap === 'function'
}

async function createCanvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Failed to create canvas context')
  }

  if (imageBitmapSupported()) {
    const imageBitmap = await window.createImageBitmap(blob)
    canvas.width = imageBitmap.width
    canvas.height = imageBitmap.height
    context.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height)
    imageBitmap.close()
    return canvas
  }

  const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(blob)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to decode imported image'))
    }

    image.src = objectUrl
  })

  canvas.width = imageElement.naturalWidth
  canvas.height = imageElement.naturalHeight
  context.drawImage(imageElement, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function createThumbnailFromBlob(blob: Blob): Promise<Blob> {
  const sourceCanvas = await createCanvasFromBlob(blob)
  return createThumbnail(sourceCanvas)
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
  const syncInProgressRef = useRef(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [isImportingFile, setIsImportingFile] = useState(false)
  const [location, setLocation] = useState<LocationSnapshot | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [showLocationDetail, setShowLocationDetail] = useState(false)
  const [pickedUp, setPickedUp] = useState(true)

  const locationWithinAccuracy = Boolean(location && location.accuracy <= MAX_LOCATION_ACCURACY_METERS)
  const locationAccepted = Boolean(location && (DISABLE_LOCATION_ACCURACY_CHECK || locationWithinAccuracy))

  const runSync = useCallback(async () => {
    if (!useConnectivityStore.getState().isOnline || syncInProgressRef.current) {
      return
    }

    syncInProgressRef.current = true

    try {
      await flushOutbox({
        apiBase: API_BASE,
        sessionToken,
        currentUserId: user?.id || null,
        currentGuestId: guestId,
      })
      notifyPicksChanged()
    } finally {
      syncInProgressRef.current = false
    }
  }, [guestId, sessionToken, user?.id])

  // Sync on mount and when going online
  useEffect(() => {
    runSync()
  }, [runSync])

  useEffect(() => {
    if (!isOnline) return

    // Came online — trigger sync immediately
    runSync()

    const interval = window.setInterval(() => {
      runSync()
    }, 15000)

    return () => {
      window.clearInterval(interval)
    }
  }, [isOnline, runSync])

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported in this browser.')
      return
    }

    let watchId: number | undefined
    let cancelled = false
    let permissionStatus: PermissionStatus | null = null

    const startWatch = () => {
      if (cancelled) return
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: Date.now(),
          })
          setLocationError(null)
        },
        (error) => {
          setLocationError(error.message)
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
      )
    }

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        if (cancelled) return
        if (result.state === 'denied') {
          setLocationError('Location access was denied. Enable it in your browser site settings.')
          return
        }
        startWatch()
        permissionStatus = result
        result.onchange = () => {
          if (result.state === 'denied') {
            setLocationError('Location access was denied. Enable it in your browser site settings.')
            if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
          }
        }
      })
    } else {
      startWatch()
    }

    return () => {
      cancelled = true
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
      if (permissionStatus) permissionStatus.onchange = null
    }
  }, [])

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

  const captureAndQueue = async () => {
    if (!videoRef.current || !captureCanvasRef.current) {
      return
    }

    if (!location || (!DISABLE_LOCATION_ACCURACY_CHECK && !locationWithinAccuracy)) {
      setCaptureError(`Location is unavailable or less accurate than ${MAX_LOCATION_ACCURACY_METERS}m. Capture rejected.`)
      return
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
      const thumbnailBlob = await createThumbnail(canvas)

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
      })

      trackEvent('spot-logged', { source: 'camera', pickedUp })
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

  const queueImportedFile = async (file: File) => {
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
          : IMPORT_DEFAULT_ACCURACY_METERS

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
      })

      trackEvent('spot-logged', { source: 'import', pickedUp })
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
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) {
      return
    }

    await queueImportedFile(selectedFile)
  }

  return (
    <fieldset className="page-card capture-panel">
      <legend>{pickedUp ? 'Log a Pick' : 'Log a Spot'}</legend>
      <div className="capture-toolbar">
        <span
          className={`capture-status-pill ${locationAccepted ? 'capture-status-pill--good' : 'capture-status-pill--warning'}`}
          onClick={() => setShowLocationDetail(prev => !prev)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1C4.5 1 3 3 3 5.25 3 8.5 7 13 7 13s4-4.5 4-7.75C11 3 9.5 1 7 1z" /><circle cx="7" cy="5.25" r="1.5" />
          </svg>
          {location ? `${Math.round(location.accuracy)}m` : 'Waiting...'}
        </span>
      </div>

      {showLocationDetail && location && (
        <p className="capture-detail">
          {DISABLE_LOCATION_ACCURACY_CHECK
            ? `Accuracy: ${Math.round(location.accuracy)}m (accuracy check disabled)`
            : locationWithinAccuracy
              ? `Accuracy: ${Math.round(location.accuracy)}m`
              : `Not accurate enough: ${Math.round(location.accuracy)}m > ${Math.round(MAX_LOCATION_ACCURACY_METERS)}m`}
        </p>
      )}

      <div className="camera-wrapper">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          className="file-import-input"
        />

        <div className="camera-actions">
          <button
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
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
                  onClick={captureAndQueue}
                  disabled={isCapturing || !locationAccepted}
                >
                {isCapturing ? 'Capturing...' : pickedUp ? 'Log Pick' : 'Log Spot'}
              </button>
            </div>
          </>
        )}
        <canvas ref={captureCanvasRef} className="capture-canvas" />
      </div>

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
    </fieldset>
  )
}
