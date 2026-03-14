import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useAuthStore } from '../stores/authStore'
import { flushOutbox, getOutboxItems, queueCapture, type OutboxItem } from '../lib/uploadOutbox'
import { extractImageMetadata } from '../lib/imageMetadata'
import { formatTimestamp } from '../utils/formatTimestamp'

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
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'
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

function formatTime(timestamp: number): string {
  return formatTimestamp(timestamp)
}

export function CapturePanel() {
  const { user, sessionToken, guestId } = useAuthStore()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const syncInProgressRef = useRef(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [isImportingFile, setIsImportingFile] = useState(false)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [location, setLocation] = useState<LocationSnapshot | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [lastCapturePreviewUrl, setLastCapturePreviewUrl] = useState<string | null>(null)
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([])

  const locationWithinAccuracy = Boolean(location && location.accuracy <= MAX_LOCATION_ACCURACY_METERS)
  const locationAccepted = Boolean(location && (DISABLE_LOCATION_ACCURACY_CHECK || locationWithinAccuracy))

  const refreshOutbox = useCallback(async () => {
    const items = await getOutboxItems()
    setOutboxItems(items)
  }, [])

  const runSync = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine || syncInProgressRef.current) {
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
      await refreshOutbox()
    } finally {
      syncInProgressRef.current = false
    }
  }, [guestId, refreshOutbox, sessionToken, user?.id])

  useEffect(() => {
    refreshOutbox()
  }, [refreshOutbox])

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      runSync()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runSync])

  useEffect(() => {
    runSync()
  }, [runSync])

  useEffect(() => {
    if (!isOnline) {
      return
    }

    const interval = window.setInterval(() => {
      runSync()
    }, 15000)

    return () => {
      window.clearInterval(interval)
    }
  }, [isOnline, runSync])

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      return
    }

    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported in this browser.')
      return
    }

    let watchId: number

    const startWatch = () => {
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
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: 30000,
        },
      )
    }

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        if (result.state === 'denied') {
          setLocationError('Location access was denied. Enable it in your browser site settings.')
          return
        }
        startWatch()
        result.onchange = () => {
          if (result.state === 'denied') {
            setLocationError('Location access was denied. Enable it in your browser site settings.')
            navigator.geolocation.clearWatch(watchId)
          }
        }
      })
    } else {
      startWatch()
    }

    return () => {
      if (watchId !== undefined) {
        navigator.geolocation.clearWatch(watchId)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (lastCapturePreviewUrl) {
        URL.revokeObjectURL(lastCapturePreviewUrl)
      }
    }
  }, [lastCapturePreviewUrl])

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

      const queued = await queueCapture({
        ownerUserId: user?.id || null,
        ownerGuestId: guestId,
        capturedAt: new Date().toISOString(),
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracy,
        mimeType: imageBlob.type || 'image/jpeg',
        imageBlob,
        thumbnailBlob,
      })

      await refreshOutbox()

      if (lastCapturePreviewUrl) {
        URL.revokeObjectURL(lastCapturePreviewUrl)
      }

      if (queued.thumbnailBlob) {
        setLastCapturePreviewUrl(URL.createObjectURL(queued.thumbnailBlob))
      }

      if (typeof navigator !== 'undefined' && navigator.onLine) {
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

      const queued = await queueCapture({
        ownerUserId: user?.id || null,
        ownerGuestId: guestId,
        capturedAt,
        latitude,
        longitude,
        accuracyMeters,
        mimeType: file.type || 'image/jpeg',
        imageBlob,
        thumbnailBlob,
      })

      await refreshOutbox()

      if (lastCapturePreviewUrl) {
        URL.revokeObjectURL(lastCapturePreviewUrl)
      }

      if (queued.thumbnailBlob) {
        setLastCapturePreviewUrl(URL.createObjectURL(queued.thumbnailBlob))
      }

      if (typeof navigator !== 'undefined' && navigator.onLine) {
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

  const pendingCount = outboxItems.filter((item) => item.status === 'pending').length
  const failedCount = outboxItems.filter((item) => item.status === 'failed').length
  const uploadingCount = outboxItems.filter((item) => item.status === 'uploading').length

  return (
    <section className="capture-panel">
      <header className="capture-header">
        <h2>Capture Cleanup</h2>
        <p>{isOnline ? 'Online - queued uploads sync automatically.' : 'Offline - captures queue locally until you reconnect.'}</p>
      </header>

      <div className="capture-status-grid">
        <div className="status-card">
          <span className="status-label">Connection</span>
          <strong className={isOnline ? 'status-good' : 'status-warning'}>{isOnline ? 'Online' : 'Offline'}</strong>
        </div>
        <div className="status-card">
          <span className="status-label">Location</span>
          <strong className={locationAccepted ? 'status-good' : 'status-warning'}>
            {location
              ? DISABLE_LOCATION_ACCURACY_CHECK
                ? `Ready (${Math.round(location.accuracy)}m, accuracy check disabled)`
                : locationWithinAccuracy
                  ? `Ready (${Math.round(location.accuracy)}m)`
                  : `Not accurate enough (${Math.round(location.accuracy)}m > ${Math.round(MAX_LOCATION_ACCURACY_METERS)}m)`
              : 'Waiting for location'}
          </strong>
        </div>
        <div className="status-card">
          <span className="status-label">Outbox</span>
          <strong>{outboxItems.length} queued</strong>
        </div>
      </div>

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
            {isImportingFile ? 'Importing...' : 'Import Photo File'}
          </button>
        </div>
        <p className="capture-hint">Imported photos must include EXIF GPS metadata, otherwise import is rejected.</p>

        {!isCameraActive ? (
          <button className="primary-button" onClick={startCamera}>Enable Camera</button>
        ) : (
          <>
            <video ref={videoRef} autoPlay muted playsInline className="camera-preview" />
            <div className="camera-actions">
                <button
                  className="primary-button"
                  onClick={captureAndQueue}
                  disabled={isCapturing || !locationAccepted}
                >
                {isCapturing ? 'Capturing...' : 'Capture and Queue'}
              </button>
              <button className="secondary-button" onClick={stopCamera}>Stop Camera</button>
            </div>
          </>
        )}
        <canvas ref={captureCanvasRef} className="capture-canvas" />
      </div>

      {lastCapturePreviewUrl && (
        <div className="last-capture">
          <h3>Latest Offline Thumbnail</h3>
          <img src={lastCapturePreviewUrl} alt="Latest capture thumbnail" />
        </div>
      )}

      <div className="outbox-summary">
        <span>Pending: {pendingCount}</span>
        <span>Uploading: {uploadingCount}</span>
        <span>Failed: {failedCount}</span>
      </div>

      {outboxItems.length > 0 && (
        <ul className="outbox-list">
          {outboxItems.slice(-8).reverse().map((item) => (
            <li key={item.id} className="outbox-item">
              <div>
                <strong>{item.status}</strong>
                <p>{formatTime(item.createdAt)} - {item.attempts} attempt{item.attempts === 1 ? '' : 's'}</p>
              </div>
              {item.lastError && <p className="outbox-error">{item.lastError}</p>}
            </li>
          ))}
        </ul>
      )}

      {locationError && <p className="error-message">Location error: {locationError}</p>}
      {captureError && <p className="error-message">{captureError}</p>}
    </section>
  )
}
