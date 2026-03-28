import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { fetchParticipatedDates } from '../stores/cleanupStore'
import { extractImageMetadata, extractTimestampFromFilename } from '../lib/imageMetadata'
import { queueCapture } from '../lib/pendingPicks'
import { createThumbnailFromBlob } from '../lib/thumbnail'
import { trackEvent } from '../lib/analytics'
import {
  matchPhotosToCleanups,
  groupMatchResults,
  type ImportedPhoto,
  type CleanupDateInfo,
  type ImportGroup,
  type MatchResult,
} from '../lib/cleanupMatching'

const IMPORT_DEFAULT_ACCURACY_METERS = Number(import.meta.env.VITE_IMPORT_DEFAULT_ACCURACY_METERS || '200')

interface BatchImportDialogProps {
  files: File[]
  pickedUp: boolean
  onDone: () => void
  onCancel: () => void
}

interface ProcessedPhoto extends ImportedPhoto {
  thumbnailUrl: string | null
  error: string | null
}

type Phase = 'processing' | 'review'

export function BatchImportDialog({ files, pickedUp, onDone, onCancel }: BatchImportDialogProps) {
  const { user, guestId } = useAuthStore()

  const [phase, setPhase] = useState<Phase>('processing')
  const [processedCount, setProcessedCount] = useState(0)
  const [photos, setPhotos] = useState<ProcessedPhoto[]>([])
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }>>([])
  const [groups, setGroups] = useState<ImportGroup[]>([])
  const [associateCleanup, setAssociateCleanup] = useState<Record<string, boolean>>({})
  const [overrides, setOverrides] = useState<Record<string, string | null>>({})
  const [importing, setImporting] = useState(false)
  const [importedGroupKeys, setImportedGroupKeys] = useState<Set<string>>(new Set())
  const [importedCount, setImportedCount] = useState(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, importing])

  useEffect(() => {
    let cancelled = false

    async function process() {
      const processed: ProcessedPhoto[] = []
      const failed: Array<{ name: string; reason: string }> = []

      for (let i = 0; i < files.length; i++) {
        if (cancelled) return
        const file = files[i]

        try {
          const metadata = await extractImageMetadata(file)
          const capturedAt =
            metadata.capturedAt ||
            extractTimestampFromFilename(file.name) ||
            new Date(file.lastModified || Date.now()).toISOString()

          const accuracyMeters =
            metadata.accuracyMeters && Number.isFinite(metadata.accuracyMeters) && metadata.accuracyMeters > 0
              ? metadata.accuracyMeters
              : IMPORT_DEFAULT_ACCURACY_METERS

          const thumbnailUrl = URL.createObjectURL(file)

          processed.push({
            file,
            capturedAt,
            latitude: metadata.latitude,
            longitude: metadata.longitude,
            accuracyMeters,
            thumbnailUrl,
            error: null,
          })
        } catch (err) {
          failed.push({
            name: file.name,
            reason: err instanceof Error ? err.message : 'Unknown error',
          })
        }

        setProcessedCount(i + 1)
      }

      if (cancelled) return

      setPhotos(processed)
      setSkipped(failed)

      if (processed.length === 0) {
        setPhase('review')
        return
      }

      // Fetch cleanup dates for matching
      let cleanupDates: CleanupDateInfo[] = []
      if (user) {
        const timestamps = processed
          .map((p) => p.capturedAt)
          .filter((t): t is string => t !== null)
          .map((t) => new Date(t).getTime())
          .filter((t) => !isNaN(t))

        if (timestamps.length > 0) {
          const earliest = new Date(Math.min(...timestamps)).toISOString()
          const latest = new Date(Math.max(...timestamps)).toISOString()
          try {
            cleanupDates = await fetchParticipatedDates(earliest, latest)
          } catch {
            // Non-critical — continue without matching
          }
        }
      }

      const results = matchPhotosToCleanups(processed, cleanupDates)
      const grouped = groupMatchResults(results)
      setGroups(grouped)

      // Default: associate with matched cleanups
      const defaults: Record<string, boolean> = {}
      for (const group of grouped) {
        defaults[group.key] = group.cleanupDate !== null
      }
      setAssociateCleanup(defaults)

      setPhase('review')
    }

    process()
    return () => { cancelled = true }
  }, [files, user])

  // Cleanup thumbnail URLs on unmount
  useEffect(() => {
    return () => {
      for (const photo of photos) {
        if (photo.thumbnailUrl) URL.revokeObjectURL(photo.thumbnailUrl)
      }
    }
  }, [photos])

  function getSelectedCleanupDate(item: MatchResult): CleanupDateInfo | null {
    const override = overrides[item.photo.file.name]
    if (override === null) return null
    if (override) {
      const all = [item.bestMatch, ...item.alternatives].filter(Boolean) as CleanupDateInfo[]
      return all.find((cd) => cd.cleanupDateId === override) || item.bestMatch
    }
    return item.bestMatch
  }

  async function importGroup(group: ImportGroup) {
    setImporting(true)
    try {
      const associate = associateCleanup[group.key] ?? false
      let count = 0

      for (const item of group.items) {
        const photo = item.photo as ProcessedPhoto
        if (photo.latitude == null || photo.longitude == null) continue

        const cleanupDate = associate ? getSelectedCleanupDate(item) : null

        await queueCapture({
          ownerUserId: user?.id || null,
          ownerGuestId: guestId,
          capturedAt: photo.capturedAt || new Date().toISOString(),
          latitude: photo.latitude,
          longitude: photo.longitude,
          accuracyMeters: photo.accuracyMeters ?? IMPORT_DEFAULT_ACCURACY_METERS,
          mimeType: photo.file.type || 'image/jpeg',
          imageBlob: photo.file,
          thumbnailBlob: await createThumbnailFromBlob(photo.file),
          pickedUp,
          cleanupId: cleanupDate?.cleanupId ?? null,
          cleanupDateId: cleanupDate?.cleanupDateId ?? null,
        })

        trackEvent('spot-logged', { source: 'batch-import', pickedUp: pickedUp ? 'true' : 'false' })
        count++
      }

      setImportedCount((prev) => prev + count)
      setImportedGroupKeys((prev) => new Set([...prev, group.key]))
    } finally {
      setImporting(false)
    }
  }

  async function importAll() {
    setImporting(true)
    try {
      let count = 0
      for (const group of groups) {
        if (importedGroupKeys.has(group.key)) continue
        const associate = associateCleanup[group.key] ?? false

        for (const item of group.items) {
          const photo = item.photo as ProcessedPhoto
          if (photo.latitude == null || photo.longitude == null) continue

          const cleanupDate = associate ? getSelectedCleanupDate(item) : null

          await queueCapture({
            ownerUserId: user?.id || null,
            ownerGuestId: guestId,
            capturedAt: photo.capturedAt || new Date().toISOString(),
            latitude: photo.latitude,
            longitude: photo.longitude,
            accuracyMeters: photo.accuracyMeters ?? IMPORT_DEFAULT_ACCURACY_METERS,
            mimeType: photo.file.type || 'image/jpeg',
            imageBlob: photo.file,
            thumbnailBlob: null,
            pickedUp,
            cleanupId: cleanupDate?.cleanupId ?? null,
            cleanupDateId: cleanupDate?.cleanupDateId ?? null,
          })

          trackEvent('spot-logged', { source: 'batch-import', pickedUp: pickedUp ? 'true' : 'false' })
          count++
        }
      }
      setImportedCount((prev) => prev + count)
      onDone()
    } finally {
      setImporting(false)
    }
  }

  function discardGroup(key: string) {
    setGroups((prev) => prev.filter((g) => g.key !== key))
  }

  const remainingGroups = groups.filter((g) => !importedGroupKeys.has(g.key))
  const allDone = remainingGroups.length === 0 && phase === 'review'

  function formatDate(iso: string | null): string {
    if (!iso) return 'Unknown date'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return 'Unknown date'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="sign-in-overlay" onClick={importing ? undefined : onCancel}>
      <div className="sign-in-dialog batch-import-dialog" onClick={(e) => e.stopPropagation()}>
        <button
          className="sign-in-close"
          onClick={onCancel}
          disabled={importing}
          aria-label="Close"
        >
          &times;
        </button>

        <h2>Import {files.length} Photo{files.length !== 1 ? 's' : ''}</h2>

        {phase === 'processing' && (
          <div className="batch-import-progress">
            <p>Processing {processedCount} of {files.length} photos&hellip;</p>
            <progress value={processedCount} max={files.length} />
          </div>
        )}

        {phase === 'review' && (
          <>
            {skipped.length > 0 && (
              <p className="batch-import-skipped">
                {skipped.length} photo{skipped.length !== 1 ? 's' : ''} skipped (no GPS data)
              </p>
            )}

            {allDone && (importedCount > 0 || photos.length > 0) && (
              <div className="batch-import-done">
                <p>{importedCount} photo{importedCount !== 1 ? 's' : ''} imported.</p>
                <button className="primary-button" onClick={onDone}>Done</button>
              </div>
            )}

            {!allDone && photos.length === 0 && (
              <div className="batch-import-done">
                <p>No photos could be imported.</p>
                <button className="secondary-button" onClick={onCancel}>Close</button>
              </div>
            )}

            {remainingGroups.map((group) => (
              <div key={group.key} className="batch-import-group">
                <div className="batch-import-group-header">
                  <strong>{group.label} ({group.items.length})</strong>
                  {group.cleanupDate && (
                    <label className="batch-import-associate">
                      <input
                        type="checkbox"
                        checked={associateCleanup[group.key] ?? false}
                        onChange={(e) =>
                          setAssociateCleanup((prev) => ({ ...prev, [group.key]: e.target.checked }))
                        }
                      />
                      Associate with this cleanup
                    </label>
                  )}
                </div>

                <div className="batch-import-items">
                  {group.items.map((item) => {
                    const photo = item.photo as ProcessedPhoto
                    const hasAlternatives = item.alternatives.length > 0
                    return (
                      <div key={photo.file.name} className="batch-import-item">
                        {photo.thumbnailUrl && (
                          <img
                            src={photo.thumbnailUrl}
                            alt={photo.file.name}
                            className="batch-import-thumbnail"
                          />
                        )}
                        <span className="batch-import-filename">{photo.file.name}</span>
                        <span className="batch-import-date">{formatDate(photo.capturedAt)}</span>
                        {hasAlternatives && associateCleanup[group.key] && (
                          <select
                            className="batch-import-select"
                            value={overrides[photo.file.name] ?? item.bestMatch?.cleanupDateId ?? ''}
                            onChange={(e) =>
                              setOverrides((prev) => ({
                                ...prev,
                                [photo.file.name]: e.target.value || null,
                              }))
                            }
                          >
                            {[item.bestMatch, ...item.alternatives]
                              .filter(Boolean)
                              .map((cd) => (
                                <option key={cd!.cleanupDateId} value={cd!.cleanupDateId}>
                                  {cd!.cleanupName} — {new Date(cd!.startAt).toLocaleDateString()}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="batch-import-group-actions">
                  <button
                    className="link-button"
                    onClick={() => discardGroup(group.key)}
                    disabled={importing}
                  >
                    Discard
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => importGroup(group)}
                    disabled={importing}
                  >
                    {importing ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </div>
            ))}

            {remainingGroups.length > 1 && (
              <div className="batch-import-actions">
                <button className="secondary-button" onClick={onCancel} disabled={importing}>
                  Cancel
                </button>
                <button className="primary-button" onClick={importAll} disabled={importing}>
                  {importing ? 'Importing...' : 'Import All'}
                </button>
              </div>
            )}

            {remainingGroups.length === 1 && (
              <div className="batch-import-actions">
                <button className="secondary-button" onClick={onCancel} disabled={importing}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
