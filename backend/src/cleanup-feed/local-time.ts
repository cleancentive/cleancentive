/**
 * Local-time arithmetic without a date library — the project has none, and
 * Intl already knows every zone's offsets, including the historical ones.
 */

function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type).value);
  return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs) / 60_000;
}

/**
 * Turns a wall-clock time in a zone into the instant it names. Applied twice:
 * the first offset can belong to the wrong side of a DST change, and the second
 * pass lands on the right one.
 */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hours, minutes);
  const first = offsetMinutes(guess, timeZone);
  let utc = guess - first * 60_000;
  const second = offsetMinutes(utc, timeZone);
  if (second !== first) {
    utc = guess - second * 60_000;
  }
  return new Date(utc);
}

/** The calendar day an instant falls on in a zone, as 'YYYY-MM-DD'. */
export function zonedDayKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
