export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function datetimeLocalToIso(local: string): string {
  return new Date(local).toISOString()
}

export function formatDateRange(startIso: string, endIso: string): string {
  const s = new Date(startIso)
  const e = new Date(endIso)
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate()
  if (sameDay) {
    const day = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    const startTime = s.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const endTime = e.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    return `${day}, ${startTime} – ${endTime}`
  }
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  return `${fmt(startIso)} – ${fmt(endIso)}`
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
