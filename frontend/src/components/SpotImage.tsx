import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEscapeKey } from '../hooks/useEscapeKey'

interface SpotLightboxProps {
  thumbnailSrc: string
  fullSrc: string | null
  alt: string
  onClose: () => void
}

function SpotLightbox({ thumbnailSrc, fullSrc, alt, onClose }: SpotLightboxProps) {
  const { t } = useTranslation('spot')
  const [isFullLoaded, setIsFullLoaded] = useState(false)

  useEscapeKey(true, onClose)

  // Decode the full-resolution image off-screen so the thumbnail stays visible
  // until it is ready, rather than blanking the overlay while it downloads.
  useEffect(() => {
    setIsFullLoaded(false)
    if (!fullSrc) return
    const preload = new Image()
    preload.onload = () => setIsFullLoaded(true)
    preload.src = fullSrc
    return () => { preload.onload = null }
  }, [fullSrc])

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <img
        className="lightbox-image"
        src={isFullLoaded && fullSrc ? fullSrc : thumbnailSrc}
        alt={alt}
      />
      {!fullSrc && <p className="lightbox-note">{t('image.originalRemoved')}</p>}
    </div>
  )
}

interface SpotImageProps {
  thumbnailSrc: string
  /** Full-resolution source, or null when only the thumbnail survives. */
  fullSrc: string | null
  alt: string
  className?: string
}

/**
 * A spot photo that renders as its thumbnail inline and opens the
 * full-resolution original in a lightbox.
 */
export function SpotImage({ thumbnailSrc, fullSrc, alt, className }: SpotImageProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)

  return (
    <>
      <img
        className={className}
        src={thumbnailSrc}
        alt={alt}
        onClick={() => setIsLightboxOpen(true)}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
      {isLightboxOpen && (
        <SpotLightbox
          thumbnailSrc={thumbnailSrc}
          fullSrc={fullSrc}
          alt={alt}
          onClose={() => setIsLightboxOpen(false)}
        />
      )}
    </>
  )
}
