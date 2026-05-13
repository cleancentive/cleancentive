interface CleanupCalendarSectionProps {
  joinedWebcal: string | null
}

export function CleanupCalendarSection({ joinedWebcal }: CleanupCalendarSectionProps) {
  return (
    <div className="cleanup-add-to-calendar">
      <strong>Add to your calendar</strong>
      <div className="calendar-actions">
        {joinedWebcal && (
          <a className="secondary-button" href={joinedWebcal}>
            Subscribe (all joined cleanups)
          </a>
        )}
        <span className="calendar-hint">
          Subscribing keeps Google / Apple / Outlook in sync as you join, leave, or organizers update dates.
          Or use the per-date links below to add a single event.
        </span>
      </div>
    </div>
  )
}
