import { createEvents, EventAttributes, DateArray } from 'ics';

export interface CalendarEventInput {
  cleanupDateId: string;
  cleanupId: string;
  cleanupName: string;
  cleanupDescription: string;
  startAt: Date;
  endAt: Date;
  latitude: number;
  longitude: number;
  locationName: string | null;
}

const PRODID = '-//CleanCentive//Cleanup Calendar//EN';

export function uidForCleanupDate(cleanupDateId: string): string {
  return `cleanup-date-${cleanupDateId}@cleancentive`;
}

function toDateArray(d: Date): DateArray {
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ];
}

function toIcsEvent(
  e: CalendarEventInput,
  appBaseUrl: string,
  options: { method?: 'PUBLISH' | 'REQUEST' | 'CANCEL'; sequence?: number; cancelled?: boolean } = {},
): EventAttributes {
  const url = `${appBaseUrl}/cleanups/${e.cleanupId}`;
  const description = (e.cleanupDescription || '').trim();
  const event: EventAttributes = {
    uid: uidForCleanupDate(e.cleanupDateId),
    start: toDateArray(e.startAt),
    startInputType: 'utc',
    startOutputType: 'utc',
    end: toDateArray(e.endAt),
    endInputType: 'utc',
    endOutputType: 'utc',
    title: e.cleanupName,
    description: description ? `${description}\n\n${url}` : url,
    location: e.locationName || undefined,
    geo: { lat: e.latitude, lon: e.longitude },
    url,
    productId: PRODID,
    sequence: options.sequence ?? 0,
  };
  if (options.cancelled) {
    event.status = 'CANCELLED';
  }
  return event;
}

export function buildFeed(events: CalendarEventInput[], appBaseUrl: string, calName: string): string {
  const ics = createEvents(
    events.map((e) => toIcsEvent(e, appBaseUrl, { sequence: 0 })),
    { productId: PRODID, calName, method: 'PUBLISH' },
  );
  if (ics.error || !ics.value) {
    throw ics.error || new Error('Failed to build ICS feed');
  }
  return ics.value;
}

export function buildSingleEventIcs(
  event: CalendarEventInput,
  appBaseUrl: string,
  options: { method: 'PUBLISH' | 'REQUEST' | 'CANCEL'; sequence: number },
): string {
  const ics = createEvents(
    [toIcsEvent(event, appBaseUrl, { method: options.method, sequence: options.sequence, cancelled: options.method === 'CANCEL' })],
    { productId: PRODID, method: options.method },
  );
  if (ics.error || !ics.value) {
    throw ics.error || new Error('Failed to build ICS event');
  }
  return ics.value;
}
