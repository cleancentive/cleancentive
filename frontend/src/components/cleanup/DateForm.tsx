import { type Frequency } from '../../lib/cleanupDates'
import { formatDateRange } from '../../utils/datetime'
import { LocationPicker } from '../LocationPicker'
import { type UseCleanupDateForm } from '../../hooks/useCleanupDateForm'

interface DateFormProps {
  form: UseCleanupDateForm
  onSubmit: (e: React.FormEvent) => void | Promise<void>
  submitLabel: string
  onCancel: () => void
  showRepeat?: boolean
  isOnline: boolean
}

export function DateForm({ form, onSubmit, submitLabel, onCancel, showRepeat = false, isOnline }: DateFormProps) {
  return (
    <form className="community-create-form" onSubmit={onSubmit}>
      <div className="form-row">
        <div className="form-group">
          <label>Start</label>
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
          <label>End</label>
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
        <p className="form-warning">Duration is less than 2 hours. Are you sure?</p>
      ) : null}

      {showRepeat && (
        <div className="repeat-section">
          <label className="repeat-toggle">
            <input
              type="checkbox"
              checked={form.repeatEnabled}
              onChange={(e) => form.setRepeatEnabled(e.target.checked)}
            />
            Repeat
          </label>
          {form.repeatEnabled && (
            <div className="repeat-options">
              <label>
                Frequency
                <select
                  value={form.repeatFrequency}
                  onChange={(e) => form.setRepeatFrequency(e.target.value as Frequency)}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label>
                Occurrences
                <input
                  type="number"
                  min={2}
                  max={52}
                  value={form.repeatCount}
                  onChange={(e) => form.setRepeatCount(Number(e.target.value))}
                />
              </label>
            </div>
          )}
          {form.repeatPreview.length > 1 && (
            <div className="repeat-preview">
              <strong>{form.repeatPreview.length} dates:</strong>
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
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
