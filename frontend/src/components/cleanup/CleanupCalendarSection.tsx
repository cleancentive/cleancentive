import { useTranslation } from 'react-i18next'

interface CleanupCalendarSectionProps {
  joinedWebcal: string | null
}

export function CleanupCalendarSection({ joinedWebcal }: CleanupCalendarSectionProps) {
  const { t } = useTranslation(['cleanups'])
  return (
    <div className="cleanup-add-to-calendar">
      <strong>{t('cleanups:calendar.heading')}</strong>
      <div className="calendar-actions">
        {joinedWebcal && (
          <a className="secondary-button" href={joinedWebcal}>
            {t('cleanups:calendar.subscribe')}
          </a>
        )}
        <span className="calendar-hint">
          {t('cleanups:calendar.hint')}
        </span>
      </div>
    </div>
  )
}
