import { useTranslation } from 'react-i18next'
import { type Frequency, MAX_OCCURRENCES } from '../../lib/cleanupDates'
import { formatDateRange } from '../../utils/datetime'
import { LocationPicker } from '../LocationPicker'
import { type UseCleanupDateForm, type RepeatMode } from '../../hooks/useCleanupDateForm'

interface DateFormProps {
  form: UseCleanupDateForm
  onSubmit: (e: React.FormEvent) => void | Promise<void>
  submitLabel: string
  onCancel: () => void
  showRepeat?: boolean
  isOnline: boolean
}

export function DateForm({ form, onSubmit, submitLabel, onCancel, showRepeat = false, isOnline }: DateFormProps) {
  const { t } = useTranslation(['cleanups', 'common'])
  return (
    <form className="community-create-form" onSubmit={onSubmit}>
      <div className="form-row">
        <div className="form-group">
          <label>{t('cleanups:dateForm.startLabel')}</label>
          <input
            type="datetime-local"
            value={form.startAt}
            min={form.nowLocal}
            onChange={(e) => form.setStartAt(e.target.value)}
            onFocus={form.handleStartFocus}
            required
          />
        </div>
        <div className="form-group">
          <label>{t('cleanups:dateForm.endLabel')}</label>
          <input
            type="datetime-local"
            value={form.endAt}
            min={form.startAt || form.nowLocal}
            onChange={(e) => form.handleEndChange(e.target.value)}
            onFocus={form.handleEndFocus}
            required
          />
        </div>
      </div>
      {form.durationHoursValue !== null && form.durationHoursValue > 0 && form.durationHoursValue < 2 ? (
        <p className="form-warning">{t('cleanups:dateForm.shortDurationWarning')}</p>
      ) : null}

      {showRepeat && (
        <div className="repeat-section">
          <label className="repeat-toggle">
            <input
              type="checkbox"
              checked={form.repeatEnabled}
              onChange={(e) => form.setRepeatEnabled(e.target.checked)}
            />
            {t('cleanups:dateForm.repeat')}
          </label>
          {form.repeatEnabled && (
            <div className="repeat-options">
              <label>
                {t('cleanups:dateForm.frequencyLabel')}
                <select
                  className="repeat-frequency"
                  value={form.repeatFrequency}
                  onChange={(e) => form.setRepeatFrequency(e.target.value as Frequency)}
                >
                  <option value="weekly">{t('cleanups:dateForm.frequency.weekly')}</option>
                  <option value="biweekly">{t('cleanups:dateForm.frequency.biweekly')}</option>
                  <option value="monthly">{t('cleanups:dateForm.frequency.monthly')}</option>
                  <option value="quarterly">{t('cleanups:dateForm.frequency.quarterly')}</option>
                  <option value="yearly">{t('cleanups:dateForm.frequency.yearly')}</option>
                </select>
              </label>
              <label>
                {t('cleanups:dateForm.endsLabel')}
                <select
                  className="repeat-ends"
                  value={form.repeatMode}
                  onChange={(e) => form.setRepeatMode(e.target.value as RepeatMode)}
                >
                  <option value="count">{t('cleanups:dateForm.ends.afterCount')}</option>
                  <option value="until">{t('cleanups:dateForm.ends.onDate')}</option>
                </select>
              </label>
              {form.repeatMode === 'count' ? (
                <label>
                  {t('cleanups:dateForm.occurrencesLabel')}
                  <input
                    className="repeat-count"
                    type="number"
                    min={2}
                    max={MAX_OCCURRENCES}
                    value={form.repeatCount}
                    onChange={(e) => form.setRepeatCount(Number(e.target.value))}
                  />
                </label>
              ) : (
                <label>
                  {t('cleanups:dateForm.untilLabel')}
                  <input
                    className="repeat-until"
                    type="date"
                    min={form.startAt.split('T')[0] || undefined}
                    value={form.repeatUntil}
                    onChange={(e) => form.setRepeatUntil(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
          {form.repeatPreview.length > 1 && (
            <div className="repeat-preview">
              <strong>{t('cleanups:dateForm.preview', { count: form.repeatPreview.length })}</strong>
              <ul>
                {form.repeatPreview.map((p, i) => (
                  <li key={i}>{formatDateRange(p.startAt, p.endAt)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <LocationPicker
        latitude={form.lat}
        longitude={form.lon}
        locationName={form.locationName}
        onLatitudeChange={form.setLat}
        onLongitudeChange={form.setLon}
        onLocationNameChange={form.setLocationName}
      />
      <div className="community-actions">
        <button type="submit" className="primary-button" disabled={!isOnline}>
          {submitLabel}{form.repeatEnabled && form.repeatPreview.length > 1 ? ` (${form.repeatPreview.length})` : ''}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>{t('common:actions.cancel')}</button>
      </div>
    </form>
  )
}
