import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCleanupFeedStore, type CleanupFeed } from '../stores/cleanupFeedStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { ConfirmDialog } from './ConfirmDialog'
import { CountdownButton } from './CountdownButton'
import { formatTimestamp } from '../utils/formatTimestamp'
import { sourceHost } from '../lib/externalUrl'

const LANGUAGES = ['de', 'fr', 'en'] as const

export function CleanupFeedsSection({ teamId }: { teamId: string }) {
  const { t } = useTranslation(['teams', 'common'])
  const { isOnline } = useConnectivityStore()
  const {
    feeds,
    availableKinds,
    preview,
    isLoading,
    busyFeedId,
    error,
    fetchFeeds,
    createFeed,
    updateFeed,
    deleteFeed,
    refreshFeed,
    previewFeed,
    clearPreview,
    clearError,
  } = useCleanupFeedStore()

  const [showAdd, setShowAdd] = useState(false)
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState('')
  const [language, setLanguage] = useState<'de' | 'fr' | 'en'>('de')
  const [namePrefix, setNamePrefix] = useState('')
  const [deleteFeedId, setDeleteFeedId] = useState<string | null>(null)

  useEffect(() => {
    fetchFeeds(teamId)
  }, [teamId, fetchFeeds])

  useEffect(() => {
    if (!kind && availableKinds.length > 0) setKind(availableKinds[0])
  }, [availableKinds, kind])

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault()
    const added = await createFeed(teamId, {
      kind,
      url: url.trim(),
      settings: { language, namePrefix: namePrefix.trim() },
    })
    if (added) {
      setShowAdd(false)
      setUrl('')
      setNamePrefix('')
    }
  }

  const pendingDelete = feeds.find((feed) => feed.id === deleteFeedId) ?? null

  return (
    <fieldset className="page-card">
      <details className="partner-settings-collapsible" open={feeds.length > 0}>
        <summary><legend style={{ display: 'inline' }}>{t('feeds.legend')}</legend></summary>
        <div className="partner-settings-body">
          <p className="partner-notice">{t('feeds.intro')}</p>

          {error && (
            <div className="error-message">
              {error}
              <button onClick={clearError}>&times;</button>
            </div>
          )}

          {feeds.length === 0 && !isLoading && <p className="end-of-list">{t('feeds.empty')}</p>}

          {feeds.map((feed) => (
            <div key={feed.id}>
              <FeedStatus feed={feed} />

              <div className="community-actions">
                <button
                  className="secondary-button"
                  disabled={!isOnline || busyFeedId === feed.id}
                  onClick={() => updateFeed(teamId, feed.id, { enabled: !feed.enabled })}
                >
                  {feed.enabled ? t('feeds.disable') : t('feeds.enable')}
                </button>
                <button
                  className="secondary-button"
                  disabled={!isOnline || !feed.enabled || busyFeedId === feed.id}
                  onClick={() => refreshFeed(teamId, feed.id)}
                >
                  {t('feeds.refreshNow')}
                </button>
                <button
                  className="secondary-button"
                  disabled={!isOnline || busyFeedId === feed.id}
                  onClick={() => previewFeed(teamId, feed.id)}
                >
                  {busyFeedId === feed.id ? t('feeds.previewing') : t('feeds.preview')}
                </button>
                <button className="link-button" onClick={() => setDeleteFeedId(feed.id)}>
                  {t('feeds.delete')}
                </button>
                <CountdownButton
                  intervalSeconds={10}
                  isLoading={isLoading}
                  disabled={!isOnline}
                  onRefresh={() => fetchFeeds(teamId)}
                  label={t('feeds.reloadStatus')}
                />
              </div>

              {preview?.feedId === feed.id && <FeedPreviewTable onClose={clearPreview} />}
            </div>
          ))}

          {showAdd ? (
            <form className="community-create-form" onSubmit={handleAdd}>
              <div className="form-group">
                <label htmlFor="feed-url">{t('feeds.urlLabel')}</label>
                <input
                  id="feed-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://cleanuptour.ch/participer/"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="feed-kind">{t('feeds.adapterLabel')}</label>
                <select id="feed-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                  {availableKinds.map((available) => (
                    <option key={available} value={available}>{t(`feeds.adapter.${available}`, available)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="feed-language">{t('feeds.languageLabel')}</label>
                <select id="feed-language" value={language} onChange={(event) => setLanguage(event.target.value as 'de' | 'fr' | 'en')}>
                  {LANGUAGES.map((option) => (
                    <option key={option} value={option}>{t(`feeds.language.${option}`)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="feed-prefix">{t('feeds.namePrefixLabel')}</label>
                <input id="feed-prefix" type="text" value={namePrefix} onChange={(event) => setNamePrefix(event.target.value)} />
                <small>{t('feeds.namePrefixHint')}</small>
              </div>
              <div className="community-actions">
                <button type="submit" className="primary-button" disabled={!isOnline || !url.trim()}>
                  {t('feeds.submit')}
                </button>
                <button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>
                  {t('common:actions.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <button className="link-button" onClick={() => setShowAdd(true)}>{t('feeds.add')}</button>
          )}
        </div>
      </details>

      {pendingDelete && (
        <ConfirmDialog
          title={t('feeds.delete')}
          actions={
            <>
              <button className="secondary-button" onClick={() => setDeleteFeedId(null)}>{t('common:actions.cancel')}</button>
              <button
                className="danger-button"
                onClick={async () => {
                  await deleteFeed(teamId, pendingDelete.id)
                  setDeleteFeedId(null)
                }}
              >
                {t('feeds.delete')}
              </button>
            </>
          }
        >
          <p>{t('feeds.deleteConfirm', { host: sourceHost(pendingDelete.url) })}</p>
        </ConfirmDialog>
      )}
    </fieldset>
  )
}

function FeedStatus({ feed }: { feed: CleanupFeed }) {
  const { t } = useTranslation(['teams'])
  const summary = feed.last_summary

  return (
    <div className={`admin-purge-status ${feed.enabled ? 'admin-purge-status--enabled' : 'admin-purge-status--disabled'}`}>
      <p>
        <strong>{t(`feeds.adapter.${feed.kind}`, feed.kind)}</strong>
        {' · '}
        <a href={feed.url} target="_blank" rel="noopener noreferrer">{sourceHost(feed.url)}</a>
        {' · '}
        {t(`feeds.language.${feed.settings.language}`)}
        {' · '}
        <span className="badge">{feed.enabled ? t('feeds.enabled') : t('feeds.disabled')}</span>
      </p>
      <p>
        {feed.last_run_at
          ? t('feeds.lastRefreshed', { time: formatTimestamp(feed.last_run_at) })
          : t('feeds.neverRefreshed')}
        {summary && ` · ${t('feeds.summary', {
          created: summary.created,
          updated: summary.updated,
          archived: summary.archived,
          errors: summary.errors.length,
        })}`}
      </p>
      {feed.last_error && <p className="form-warning">{t('feeds.lastError', { error: feed.last_error })}</p>}
    </div>
  )
}

function FeedPreviewTable({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['teams', 'common'])
  const preview = useCleanupFeedStore((state) => state.preview)
  const result = preview?.result

  if (!result || result.state === 'none') return null
  if (result.state === 'failed') {
    return <p className="form-warning">{t('feeds.lastError', { error: result.error })}</p>
  }
  if (result.state !== 'done') {
    return <p className="end-of-list">{t('feeds.previewing')}</p>
  }

  const entries = result.plan.entries
  return (
    <div>
      <p>
        <strong>{t('feeds.previewTitle', { count: entries.length })}</strong>
        {' '}
        <button className="link-button" onClick={onClose}>{t('common:actions.close')}</button>
      </p>
      {entries.length === 0 ? (
        <p className="end-of-list">{t('feeds.previewEmpty')}</p>
      ) : (
        <div className="ops-version-table-wrap">
          <table className="ops-version-table">
            <thead>
              <tr>
                <th>{t('feeds.previewAction')}</th>
                <th>{t('feeds.previewCleanup')}</th>
                <th>{t('feeds.previewDate')}</th>
                <th>{t('feeds.previewNote')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.action}-${entry.name}-${index}`}>
                  <td>{t(`feeds.action.${entry.action}`)}</td>
                  <td>{entry.name}</td>
                  <td>{entry.startAt ? new Date(entry.startAt).toLocaleDateString() : '—'}</td>
                  <td>{entry.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
