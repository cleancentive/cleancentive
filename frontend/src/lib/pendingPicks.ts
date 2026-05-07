import { v7 as uuidv7 } from 'uuid'
import { reportClientEvent, type IdentityHint } from './clientEvents'

const DB_NAME = 'cleancentive-offline'
const DB_VERSION = 4
const STORE_NAME = 'pending-picks'

const REPORT_ATTEMPT_THRESHOLD = 3
const REPORT_IDENTITY_MISMATCH_MIN_AGE_MS = 24 * 60 * 60 * 1000

export type OutboxStatus = 'pending' | 'uploading' | 'failed'

export interface OutboxItem {
  id: string
  ownerUserId: string | null
  ownerGuestId: string | null
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number
  mimeType: string
  imageBlob: Blob
  thumbnailBlob: Blob | null
  pickedUp: boolean
  cleanupId: string | null
  cleanupDateId: string | null
  status: OutboxStatus
  attempts: number
  lastError: string | null
  nextRetryAt: number
  createdAt: number
  reportedAt: number | null
}

interface QueueCaptureInput {
  ownerUserId: string | null
  ownerGuestId: string | null
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number
  mimeType: string
  imageBlob: Blob
  thumbnailBlob: Blob | null
  pickedUp?: boolean
  cleanupId?: string | null
  cleanupDateId?: string | null
}

interface FlushContext {
  apiBase: string
  sessionToken: string | null
  currentUserId: string | null
  currentGuestId: string | null
  isOnline?: () => boolean
}

class UploadRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const PROXY_HICCUP_STATUSES = new Set([502, 503, 504])
const PROXY_HICCUP_SCHEDULE_MS = [15_000, 30_000, 60_000]

function getRetryDelayMs(attempt: number, status?: number): number {
  if (status && status >= 400 && status < 500 && status !== 429) {
    return 24 * 60 * 60 * 1000
  }

  if (status && PROXY_HICCUP_STATUSES.has(status) && attempt - 1 < PROXY_HICCUP_SCHEDULE_MS.length) {
    return PROXY_HICCUP_SCHEDULE_MS[attempt - 1]
  }

  const exponential = 5000 * 2 ** Math.min(attempt, 8)
  return Math.min(exponential, 15 * 60 * 1000)
}

function shouldReportFailure(attempt: number, status: number | null, alreadyReported: boolean): boolean {
  if (alreadyReported) return false
  if (status !== null && PROXY_HICCUP_STATUSES.has(status)) return true
  return attempt >= REPORT_ATTEMPT_THRESHOLD
}

function isContextOnline(context: FlushContext): boolean {
  if (context.isOnline) return context.isOnline()
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

function isTabVisible(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

function emitPicksChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('picks-changed'))
}

let scheduledTimerId: ReturnType<typeof setTimeout> | null = null
let listenersRegistered = false
let lastContext: FlushContext | null = null
let flushInFlight = false

function clearScheduledFlush(): void {
  if (scheduledTimerId !== null) {
    clearTimeout(scheduledTimerId)
    scheduledTimerId = null
  }
}

export function cancelScheduledFlush(): void {
  clearScheduledFlush()
}

function ensureListeners(): void {
  if (listenersRegistered) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  listenersRegistered = true

  window.addEventListener('online', () => {
    if (lastContext) void flushOutbox(lastContext)
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearScheduledFlush()
    } else if (lastContext) {
      void flushOutbox(lastContext)
    }
  })
}

export async function scheduleNextFlush(context: FlushContext): Promise<void> {
  lastContext = context
  ensureListeners()
  clearScheduledFlush()

  if (!isContextOnline(context) || !isTabVisible()) {
    return
  }

  const items = await getOutboxItems()
  const now = Date.now()

  const dueNow = items.some(
    (item) => item.status === 'pending' || (item.status === 'failed' && item.nextRetryAt <= now),
  )
  if (dueNow) {
    void flushOutbox(context)
    return
  }

  let nextAt = Number.POSITIVE_INFINITY
  for (const item of items) {
    if (item.status === 'failed' && item.nextRetryAt > now && item.nextRetryAt < nextAt) {
      nextAt = item.nextRetryAt
    }
  }

  if (!Number.isFinite(nextAt)) {
    return
  }

  const delay = Math.max(1000, Math.min(nextAt - now, 15 * 60 * 1000))
  scheduledTimerId = setTimeout(() => {
    scheduledTimerId = null
    if (lastContext) void flushOutbox(lastContext)
  }, delay)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'))
    }

    request.onupgradeneeded = (event) => {
      const database = request.result
      if (database.objectStoreNames.contains('upload-outbox')) {
        database.deleteObjectStore('upload-outbox')
      }
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }

      if (event.oldVersion < 4 && request.transaction) {
        const store = request.transaction.objectStore(STORE_NAME)
        const cursorRequest = store.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          const value = cursor.value as OutboxItem
          if (value.reportedAt === undefined) {
            cursor.update({ ...value, reportedAt: null })
          }
          cursor.continue()
        }
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      reject(request.error || new Error('IndexedDB request failed'))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
  })
}

export async function queueCapture(input: QueueCaptureInput): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: uuidv7(),
    ownerUserId: input.ownerUserId,
    ownerGuestId: input.ownerGuestId,
    capturedAt: input.capturedAt,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
    mimeType: input.mimeType,
    imageBlob: input.imageBlob,
    thumbnailBlob: input.thumbnailBlob,
    pickedUp: input.pickedUp ?? true,
    cleanupId: input.cleanupId ?? null,
    cleanupDateId: input.cleanupDateId ?? null,
    status: 'pending',
    attempts: 0,
    lastError: null,
    nextRetryAt: Date.now(),
    createdAt: Date.now(),
    reportedAt: null,
  }

  const database = await openDatabase()

  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    await requestToPromise(store.put(item))
    return item
  } finally {
    database.close()
  }
}

export async function getOutboxItems(): Promise<OutboxItem[]> {
  const database = await openDatabase()

  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const result = await requestToPromise(store.getAll())
    const items = (result || []) as OutboxItem[]
    return items.sort((a, b) => a.createdAt - b.createdAt)
  } finally {
    database.close()
  }
}

async function updateOutboxItem(id: string, updater: (item: OutboxItem) => OutboxItem): Promise<void> {
  const database = await openDatabase()

  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const existing = (await requestToPromise(store.get(id))) as OutboxItem | undefined
    if (!existing) {
      return
    }
    await requestToPromise(store.put(updater(existing)))
  } finally {
    database.close()
  }
}

async function removeOutboxItem(id: string): Promise<void> {
  const database = await openDatabase()

  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    await requestToPromise(store.delete(id))
  } finally {
    database.close()
  }
}

function canCurrentIdentityUpload(item: OutboxItem, context: FlushContext): boolean {
  if (item.ownerUserId) {
    return item.ownerUserId === context.currentUserId
  }

  if (context.currentUserId) {
    return true
  }

  if (!item.ownerGuestId) {
    return false
  }

  return item.ownerGuestId === context.currentGuestId
}

function identityHintFor(item: OutboxItem, context: FlushContext): IdentityHint {
  if (!context.currentUserId && !context.currentGuestId) {
    return 'no-current-identity'
  }
  if (item.ownerUserId && context.currentUserId && item.ownerUserId !== context.currentUserId) {
    return 'mismatch'
  }
  if (!item.ownerUserId && item.ownerGuestId && context.currentGuestId && item.ownerGuestId !== context.currentGuestId) {
    return 'mismatch'
  }
  return 'matches'
}

async function uploadItem(item: OutboxItem, context: FlushContext): Promise<void> {
  const formData = new FormData()
  const imageFile = new File([item.imageBlob], `${item.id}.jpg`, { type: item.mimeType })

  formData.append('image', imageFile)
  if (item.thumbnailBlob) {
    const thumbnailFile = new File([item.thumbnailBlob], `${item.id}-thumb.jpg`, { type: 'image/jpeg' })
    formData.append('thumbnail', thumbnailFile)
  }

  formData.append('uploadId', item.id)
  formData.append('capturedAt', item.capturedAt)
  formData.append('latitude', String(item.latitude))
  formData.append('longitude', String(item.longitude))
  formData.append('accuracyMeters', String(item.accuracyMeters))
  formData.append('pickedUp', String(item.pickedUp ?? true))

  if (item.cleanupId) {
    formData.append('cleanupId', item.cleanupId)
  }
  if (item.cleanupDateId) {
    formData.append('cleanupDateId', item.cleanupDateId)
  }

  if (!context.sessionToken && item.ownerGuestId) {
    formData.append('guestId', item.ownerGuestId)
  }

  const headers: Record<string, string> = {}
  if (context.sessionToken) {
    headers.Authorization = `Bearer ${context.sessionToken}`
  }

  const response = await fetch(`${context.apiBase}/spots`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!response.ok) {
    const body = await response.text()
    const message = body.trim() || `${response.status} ${response.statusText}`
    throw new UploadRequestError(response.status, message)
  }
}

export async function flushOutbox(context: FlushContext): Promise<void> {
  lastContext = context
  ensureListeners()

  if (flushInFlight) return
  if (!isContextOnline(context)) {
    clearScheduledFlush()
    return
  }

  flushInFlight = true
  let stateChanged = false

  try {
    const items = await getOutboxItems()
    const now = Date.now()

    for (const item of items) {
      const retryReady = item.status === 'failed' && (item.nextRetryAt <= now || !item.nextRetryAt)
      if (item.status !== 'pending' && !retryReady) {
        continue
      }

      if (!canCurrentIdentityUpload(item, context)) {
        const ageMs = now - item.createdAt
        if ((item.reportedAt ?? null) === null && ageMs >= REPORT_IDENTITY_MISMATCH_MIN_AGE_MS) {
          reportClientEvent({
            eventType: 'pick.upload.skipped.identity-mismatch',
            itemId: item.id,
            attempts: item.attempts,
            ageMs,
            identityHint: identityHintFor(item, context),
          })
          await updateOutboxItem(item.id, (current) => ({ ...current, reportedAt: Date.now() }))
        }
        continue
      }

      await updateOutboxItem(item.id, (current) => ({
        ...current,
        status: 'uploading',
        lastError: null,
      }))
      stateChanged = true

      try {
        await uploadItem(item, context)
        await removeOutboxItem(item.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        const status = error instanceof UploadRequestError ? error.status : null
        const nextAttempts = item.attempts + 1
        const alreadyReported = (item.reportedAt ?? null) !== null
        const shouldReport = shouldReportFailure(nextAttempts, status, alreadyReported)
        const reportedAt = shouldReport ? Date.now() : (item.reportedAt ?? null)

        await updateOutboxItem(item.id, (current) => ({
          ...current,
          status: 'failed',
          attempts: current.attempts + 1,
          lastError: message,
          nextRetryAt: Date.now() + getRetryDelayMs(current.attempts + 1, status ?? undefined),
          reportedAt,
        }))

        if (shouldReport) {
          reportClientEvent({
            eventType: 'pick.upload.failed',
            itemId: item.id,
            attempts: nextAttempts,
            ageMs: Date.now() - item.createdAt,
            status,
            message,
          })
        }
      }
    }
  } finally {
    flushInFlight = false
    if (stateChanged) emitPicksChanged()
    void scheduleNextFlush(context)
  }
}
