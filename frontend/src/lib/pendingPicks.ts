import { v7 as uuidv7 } from 'uuid'

const DB_NAME = 'cleancentive-offline'
const DB_VERSION = 2
const STORE_NAME = 'pending-picks'

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
  status: OutboxStatus
  attempts: number
  lastError: string | null
  nextRetryAt: number
  createdAt: number
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
}

interface FlushContext {
  apiBase: string
  sessionToken: string | null
  currentUserId: string | null
  currentGuestId: string | null
}

class UploadRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function getRetryDelayMs(attempt: number, status?: number): number {
  if (status && status >= 400 && status < 500 && status !== 429) {
    return 24 * 60 * 60 * 1000
  }

  const exponential = 5000 * 2 ** Math.min(attempt, 8)
  return Math.min(exponential, 15 * 60 * 1000)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'))
    }

    request.onupgradeneeded = () => {
      const database = request.result
      if (database.objectStoreNames.contains('upload-outbox')) {
        database.deleteObjectStore('upload-outbox')
      }
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
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
    status: 'pending',
    attempts: 0,
    lastError: null,
    nextRetryAt: Date.now(),
    createdAt: Date.now(),
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
  const items = await getOutboxItems()
  const now = Date.now()

  for (const item of items) {
    const retryReady = item.status === 'failed' && (item.nextRetryAt <= now || !item.nextRetryAt)
    if (item.status !== 'pending' && !retryReady) {
      continue
    }

    if (!canCurrentIdentityUpload(item, context)) {
      continue
    }

    await updateOutboxItem(item.id, (current) => ({
      ...current,
      status: 'uploading',
      lastError: null,
    }))

    try {
      await uploadItem(item, context)
      await removeOutboxItem(item.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      await updateOutboxItem(item.id, (current) => ({
        ...current,
        status: 'failed',
        attempts: current.attempts + 1,
        lastError: message,
        nextRetryAt: Date.now() + getRetryDelayMs(current.attempts + 1, error instanceof UploadRequestError ? error.status : undefined),
      }))
    }
  }
}
