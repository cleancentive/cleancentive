export function createBlobFromCanvas(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
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

export function createThumbnailFromCanvas(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
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

export async function createThumbnailFromBlob(blob: Blob): Promise<Blob> {
  const sourceCanvas = await createCanvasFromBlob(blob)
  return createThumbnailFromCanvas(sourceCanvas)
}
