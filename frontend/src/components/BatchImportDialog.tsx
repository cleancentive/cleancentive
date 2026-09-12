import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { fetchParticipatedDates } from '../stores/cleanupStore'
import { extractImageMetadata, extractTimestampFromFilename } from '../lib/imageMetadata'
import { queueCapture } from '../lib/pendingPicks'
import { createThumbnailFromBlob } from '../lib/thumbnail'
import { ManualLocationDialog } from './ManualLocationDialog'
import { trackEvent } from '../lib/analytics'
import {
  matchPhotosToCleanups,
  groupMatchResults,
  type ImportedPhoto,
  type CleanupDateInfo,
  type ImportGroup,
  type MatchResult,
} from '../lib/cleanupMatching'

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
  const { t } = useTranslation(['map', 'common'])
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
  // One pin for the whole batch: a set of photos imported together is almost
  // always one outing, so asking once beats asking per photo.
  const [batchPin, setBatchPin] = useState<{ latitude: number; longitude: number } | null>(null)
  const [showBatchPicker, setShowBatchPicker] = useState(false)
  const [unplacedCount, setUnplacedCount] = useState(0)
  const [importError, setImportError] = useState<string | null>(null)

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
              : null

          const thumbnailUrl = URL.createObjectURL(file)
          const located = metadata.status === 'located'
          if (!located) {
            trackEvent('spot-import-failed', { reason: metadata.reason, source: 'batch-import' })
          }

          // A photo without coordinates is kept and offered a pin later, rather
          // than dropped here. Matching already degrades to time-only for these.
          processed.push({
            file,
            capturedAt,
            latitude: located ? metadata.latitude : null,
            longitude: located ? metadata.longitude : null,
            accuracyMeters,
            thumbnailUrl,
            error: null,
          })
        } catch (err) {
          failed.push({
            name: file.name,
            reason: err instanceof Error ? err.message : t('import.unknownError'),
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
    // Re-running on a language change would restart the whole import; `t` is only
    // used for labels inside, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function resolvePlacement(
    photo: ProcessedPhoto,
  ): { latitude: number; longitude: number; accuracyMeters: number | null } | null {
    if (photo.latitude != null && photo.longitude != null) {
      return { latitude: photo.latitude, longitude: photo.longitude, accuracyMeters: photo.accuracyMeters }
    }
    if (batchPin) {
      return { latitude: batchPin.latitude, longitude: batchPin.longitude, accuracyMeters: null }
    }
    return null
  }

  async function queueGroupItems(group: ImportGroup): Promise<{ queued: number; unplaced: number }> {
    const associate = associateCleanup[group.key] ?? false
    let queued = 0
    let unplaced = 0

    for (const item of group.items) {
      const photo = item.photo as ProcessedPhoto
      const placement = resolvePlacement(photo)
      if (!placement) {
        unplaced++
        continue
      }

      const cleanupDate = associate ? getSelectedCleanupDate(item) : null

      // A thumbnail we cannot build must not cost us the photo.
      let thumbnailBlob: Blob | null = null
      try {
        thumbnailBlob = await createThumbnailFromBlob(photo.file)
      } catch {
        trackEvent('spot-import-failed', { reason: 'thumbnail-failed', source: 'batch-import' })
      }

      await queueCapture({
        ownerUserId: user?.id || null,
        ownerGuestId: guestId,
        capturedAt: photo.capturedAt || new Date().toISOString(),
        latitude: placement.latitude,
        longitude: placement.longitude,
        accuracyMeters: placement.accuracyMeters,
        mimeType: photo.file.type || 'image/jpeg',
        imageBlob: photo.file,
        thumbnailBlob,
        pickedUp,
        cleanupId: cleanupDate?.cleanupId ?? null,
        cleanupDateId: cleanupDate?.cleanupDateId ?? null,
      })

      trackEvent('spot-logged', { source: 'batch-import', pickedUp: pickedUp ? 'true' : 'false' })
      if (photo.latitude == null || photo.longitude == null) {
        trackEvent('spot-import-recovered', { method: 'batch-pin', source: 'batch-import' })
      }
      queued++
    }

    return { queued, unplaced }
  }

  async function importGroup(group: ImportGroup) {
    setImporting(true)
    setImportError(null)
    try {
      const { queued, unplaced } = await queueGroupItems(group)
      setImportedCount((prev) => prev + queued)
      setUnplacedCount((prev) => prev + unplaced)
      setImportedGroupKeys((prev) => new Set([...prev, group.key]))
    } catch (err) {
      setImportError(t('import.importFailed', { message: err instanceof Error ? err.message : t('import.unknownError') }))
      trackEvent('spot-import-failed', { reason: 'queue-failed', source: 'batch-import' })
    } finally {
      setImporting(false)
    }
  }

  async function importAll() {
    setImporting(true)
    setImportError(null)
    try {
      let queued = 0
      let unplaced = 0
      for (const group of groups) {
        if (importedGroupKeys.has(group.key)) continue
        const result = await queueGroupItems(group)
        queued += result.queued
        unplaced += result.unplaced
      }
      setImportedCount((prev) => prev + queued)
      setUnplacedCount((prev) => prev + unplaced)
      onDone()
    } catch (err) {
      setImportError(t('import.importFailed', { message: err instanceof Error ? err.message : t('import.unknownError') }))
      trackEvent('spot-import-failed', { reason: 'queue-failed', source: 'batch-import' })
    } finally {
      setImporting(false)
    }
  }

  function discardGroup(key: string) {
    setGroups((prev) => prev.filter((g) => g.key !== key))
  }

  const remainingGroups = groups.filter((g) => !importedGroupKeys.has(g.key))
  const allDone = remainingGroups.length === 0 && phase === 'review'

  const needsLocationCount = photos.filter((p) => p.latitude == null || p.longitude == null).length

  function formatDate(iso: string | null): string {
    if (!iso) return t('import.unknownDate')
    const d = new Date(iso)
    if (isNaN(d.getTime())) return t('import.unknownDate')
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="sign-in-overlay" onClick={importing ? undefined : onCancel}>
      <div className="sign-in-dialog batch-import-dialog" onClick={(e) => e.stopPropagation()}>
        <button
          className="sign-in-close"
          onClick={onCancel}
          disabled={importing}
          aria-label={t('common:actions.close')}
        >
          &times;
        </button>

        <h2>{t('import.title', { count: files.length })}</h2>

        {phase === 'processing' && (
          <div className="batch-import-progress">
            <p>{t('import.processing', { processed: processedCount, total: files.length })}</p>
            <progress value={processedCount} max={files.length} />
          </div>
        )}

        {phase === 'review' && (
          <>
            {skipped.length > 0 && (
              <p className="batch-import-skipped">
                {t('import.skipped', { count: skipped.length })}
              </p>
            )}

            {needsLocationCount > 0 && (
              <div className="batch-import-needs-location">
                {batchPin ? (
                  <p className="batch-import-skipped">
                    {t('import.placedAll', { count: needsLocationCount })}{' '}
                    <button className="link-button" onClick={() => setShowBatchPicker(true)} disabled={importing}>
                      {t('import.repin')}
                    </button>
                  </p>
                ) : (
                  <>
                    <p className="batch-import-skipped">
                      {t('import.needsLocation', { count: needsLocationCount })}
                      <br />
                      {t('import.needsLocationHint')}
                    </p>
                    <button className="secondary-button" onClick={() => setShowBatchPicker(true)} disabled={importing}>
                      {t('import.placeAll')}
                    </button>
                  </>
                )}
              </div>
            )}

            {importError && <p className="error-message">{importError}</p>}

            {unplacedCount > 0 && (
              <p className="batch-import-skipped">{t('import.stillUnplaced', { count: unplacedCount })}</p>
            )}

            {allDone && (importedCount > 0 || photos.length > 0) && (
              <div className="batch-import-done">
                <p>{t('import.imported', { count: importedCount })}</p>
                <button className="primary-button" onClick={onDone}>{t('import.done')}</button>
              </div>
            )}

            {!allDone && photos.length === 0 && (
              <div className="batch-import-done">
                <p>{t('import.noneImported')}</p>
                <button className="secondary-button" onClick={onCancel}>{t('common:actions.close')}</button>
              </div>
            )}

            {remainingGroups.map((group) => (
              <div key={group.key} className="batch-import-group">
                <div className="batch-import-group-header">
                  <strong>{t('import.groupHeader', { label: group.cleanupDate ? group.label : t('import.noCleanupMatch'), count: group.items.length })}</strong>
                  {group.cleanupDate && (
                    <label className="batch-import-associate">
                      <input
                        type="checkbox"
                        checked={associateCleanup[group.key] ?? false}
                        onChange={(e) =>
                          setAssociateCleanup((prev) => ({ ...prev, [group.key]: e.target.checked }))
                        }
                      />
                      {t('import.associate')}
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
                    {t('import.discard')}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => importGroup(group)}
                    disabled={importing}
                  >
                    {importing ? t('import.importing') : t('import.import')}
                  </button>
                </div>
              </div>
            ))}

            {remainingGroups.length > 1 && (
              <div className="batch-import-actions">
                <button className="secondary-button" onClick={onCancel} disabled={importing}>
                  {t('common:actions.cancel')}
                </button>
                <button className="primary-button" onClick={importAll} disabled={importing}>
                  {importing ? t('import.importing') : t('import.importAll')}
                </button>
              </div>
            )}

            {remainingGroups.length === 1 && (
              <div className="batch-import-actions">
                <button className="secondary-button" onClick={onCancel} disabled={importing}>
                  {t('common:actions.cancel')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* The picker brings its own backdrop; keep its clicks from reaching the
          batch overlay behind it, which would cancel the whole import. */}
      {showBatchPicker && (
        <div onClick={(e) => e.stopPropagation()}>
          <ManualLocationDialog
            initialLatitude={batchPin?.latitude ?? null}
            initialLongitude={batchPin?.longitude ?? null}
            onConfirm={(latitude, longitude) => {
              setBatchPin({ latitude, longitude })
              setShowBatchPicker(false)
            }}
            onCancel={() => setShowBatchPicker(false)}
          />
        </div>
      )}
    </div>
  )
}
