import type { CleanupFeed } from '../cleanup-feed.entity';
import type { AdapterContext, ExternalCleanup, ExternalListing, FeedAdapter } from './adapter';
import { decodeEntities, htmlToText, capText } from '../html-text';
import { zonedToUtc } from '../local-time';
import { parseDayMonth, inferYear, extractTimes } from './cleanuptour-text';

const TIME_ZONE = 'Europe/Zurich';
const MAX_DESCRIPTION_BYTES = 8 * 1024;
const MAX_LISTING_PAGES = 5;

/** WordPress post as the site's REST API returns it. */
interface WordPressEvent {
  id: number;
  slug: string;
  link: string;
  status: string;
  title: { rendered: string };
  date_gmt: string;
  modified_gmt: string;
}

/**
 * cleanuptour.ch — the Clean-Up Tour season run by Summit Foundation.
 *
 * The site is WordPress with a Bricks-built theme. Its REST API lists the events
 * with stable ids and modification dates but exposes none of the custom fields,
 * so the date, address and programme come from the rendered pages. The listing
 * page carries every event's day and month, which is what lets a refresh skip
 * the detail pages of events that already happened.
 */
export const cleanuptourAdapter: FeedAdapter = {
  kind: 'cleanuptour',

  async list(feed: CleanupFeed, ctx: AdapterContext): Promise<ExternalListing[]> {
    const posts = await fetchAllEvents(feed, ctx);
    const listingHtml = await ctx.fetchHtml(feed.url);
    const seasonYear = parseSeasonYear(listingHtml);
    const datesByUrl = parseListingDates(listingHtml, seasonYear);

    return posts.map((post) => ({
      externalId: String(post.id),
      url: post.link,
      title: decodeEntities(post.title.rendered),
      version: post.modified_gmt,
      startsOn: datesByUrl.get(normalizeUrl(post.link)) ?? null,
    }));
  },

  async fetchDetail(listing: ExternalListing, feed: CleanupFeed, ctx: AdapterContext): Promise<ExternalCleanup> {
    const localizedUrl = localizeUrl(listing.url, feed.settings.language);
    const html = await ctx.fetchHtml(localizedUrl);
    let page = parseEventPage(html);
    let usedUrl = localizedUrl;

    // The site falls back to French when a translation is missing, but a
    // half-translated page can still lack the pieces we need.
    if ((!page.dateText || !page.body) && localizedUrl !== listing.url) {
      ctx.logger.warn(`cleanuptour: ${localizedUrl} incomplete, falling back to ${listing.url}`);
      const fallback = parseEventPage(await ctx.fetchHtml(listing.url));
      // Only claim the fallback page as the source if it is the one that
      // actually carried the text; a page can simply have no programme on it.
      if (!page.body && fallback.body) {
        usedUrl = listing.url;
      }
      page = {
        title: page.title || fallback.title,
        dateText: page.dateText || fallback.dateText,
        body: page.body || fallback.body,
        address: page.address ?? fallback.address,
        registrationUrl: page.registrationUrl ?? fallback.registrationUrl,
      };
    }

    const startAt = resolveStart(listing, page);
    const times = extractTimes(page.body);
    const [year, month, day] = [startAt.year, startAt.month, startAt.day];

    const start = zonedToUtc(year, month, day, times.startHour, times.startMinute, TIME_ZONE);
    const end = zonedToUtc(year, month, day, times.endHour, times.endMinute, TIME_ZONE);

    return {
      externalId: listing.externalId,
      title: page.title || listing.title,
      body: capText(page.body, MAX_DESCRIPTION_BYTES),
      url: usedUrl,
      registrationUrl: page.registrationUrl,
      startAt: start,
      endAt: end > start ? end : new Date(start.getTime() + 6 * 60 * 60 * 1000),
      address: page.address,
      latitude: null,
      longitude: null,
      locationName: page.title || listing.title,
      version: listing.version,
    };
  },
};

async function fetchAllEvents(feed: CleanupFeed, ctx: AdapterContext): Promise<WordPressEvent[]> {
  const origin = new URL(feed.url).origin;
  const collected: WordPressEvent[] = [];
  let expected: number | null = null;

  for (let page = 1; page <= MAX_LISTING_PAGES; page++) {
    const url = `${origin}/wp-json/wp/v2/event?per_page=100&page=${page}`
      + '&_fields=id,slug,link,title,status,date_gmt,modified_gmt';
    const { body, headers } = await ctx.fetchJson<WordPressEvent[]>(url);
    collected.push(...body);

    expected ??= Number(headers.get('x-wp-total') ?? body.length);
    const totalPages = Number(headers.get('x-wp-totalpages') ?? '1');
    if (page >= totalPages) {
      break;
    }
  }

  // A short listing would look like events were withdrawn, and a refresh
  // archives what it cannot find. Better to fail the whole run.
  if (expected !== null && collected.length !== expected) {
    throw new Error(`cleanuptour listing is incomplete: got ${collected.length} of ${expected} events`);
  }

  return collected.filter((post) => post.status === 'publish');
}

/** "Clean-Up Tour 2026" in the listing heading. */
function parseSeasonYear(html: string): number | null {
  const match = /Clean-Up\s*Tour\s*(20\d{2})/i.exec(html);
  return match ? Number(match[1]) : null;
}

/**
 * The listing renders each event as a card with its day and month, which is how
 * a refresh knows what is still upcoming before opening any detail page.
 */
function parseListingDates(html: string, seasonYear: number | null): Map<string, string> {
  const dates = new Map<string, string>();
  if (seasonYear === null) {
    return dates;
  }

  const cards = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*bloc-event-list[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const card of html.matchAll(cards)) {
    const [, href, inner] = card;
    const parts = /brxe-text-basic[^>]*>(\d{1,2})<\/div>\s*<div[^>]*brxe-text-basic[^>]*>([^<]+)<\/div>/i.exec(inner);
    if (!parts) {
      continue;
    }
    const parsed = parseDayMonth(`${parts[1]} ${parts[2]}`);
    if (!parsed) {
      continue;
    }
    const iso = `${seasonYear}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
    dates.set(normalizeUrl(decodeEntities(href)), iso);
  }
  return dates;
}

interface EventPage {
  title: string;
  dateText: string;
  body: string;
  address: string | null;
  registrationUrl: string | null;
}

/**
 * Pulls an event page apart at the anchors the Bricks template gives every
 * event: the date line, the sign-up button, the map, and the content blocks
 * between the button and the map heading.
 */
export function parseEventPage(html: string): EventPage {
  const title = firstMatch(html, /<h1[^>]*brxe-post-title[^>]*>([^<]*)<\/h1>/i);
  const dateText = firstMatch(html, /<div[^>]*id="brxe-zbylzg"[^>]*>([^<]*)<\/div>/i);
  const registrationUrl = firstMatch(html, /<a[^>]*id="brxe-pgulzh"[^>]*href="([^"]+)"/i) || null;

  return {
    title: title ? decodeEntities(title).trim() : '',
    dateText: dateText ? decodeEntities(dateText).trim() : '',
    body: parseBody(html),
    address: parseAddress(html),
    registrationUrl: registrationUrl ? decodeEntities(registrationUrl) : null,
  };
}

/**
 * Everything between the sign-up button and the map heading: the programme,
 * meeting point and practical notes. Bounding it this way leaves out the
 * recap counters a past event shows and the teaser for the next cleanups.
 */
function parseBody(html: string): string {
  const buttonEnd = indexAfter(html, /<a[^>]*id="brxe-pgulzh"[^>]*>[\s\S]*?<\/a>/i);
  if (buttonEnd === null) {
    return '';
  }
  const mapStart = indexOfAny(html, [/<h3[^>]*id="brxe-qejvqb"/i, /<div[^>]*class="[^"]*brxe-map[^"]*"/i], buttonEnd);
  const section = html.slice(buttonEnd, mapStart ?? html.length);

  // brxe-text, not brxe-text-basic: the -basic variant labels a past event's
  // recap counters, which are numbers we have no field for.
  const blocks = /<(h[1-6]|div)[^>]*class="[^"]*brxe-(heading|text)(?![\w-])[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  const parts: string[] = [];
  for (const block of section.matchAll(blocks)) {
    const text = htmlToText(block[3]);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join('\n\n').trim();
}

/** The map element carries the postal address; its centre is a theme default. */
function parseAddress(html: string): string | null {
  const raw = firstMatch(html, /data-bricks-map-options="([^"]*)"/i);
  if (!raw) {
    return null;
  }
  try {
    const options = JSON.parse(decodeEntities(raw)) as { addresses?: Array<{ address?: string }> };
    const address = options.addresses?.[0]?.address;
    return address ? address.trim() : null;
  } catch {
    return null;
  }
}

function resolveStart(listing: ExternalListing, page: EventPage): { year: number; month: number; day: number } {
  const fromPage = parseDayMonth(page.dateText);
  const fromListing = listing.startsOn ? isoToParts(listing.startsOn) : null;
  const dayMonth = fromPage ?? (fromListing ? { day: fromListing.day, month: fromListing.month } : null);
  if (!dayMonth) {
    throw new Error(`no date found for ${listing.url}`);
  }

  // The listing already agreed on a day: trust its year rather than re-deriving.
  if (fromListing && fromListing.day === dayMonth.day && fromListing.month === dayMonth.month) {
    return { year: fromListing.year, month: dayMonth.month, day: dayMonth.day };
  }

  const year = inferYear({
    day: dayMonth.day,
    month: dayMonth.month,
    bodyText: page.body,
    seasonYear: fromListing?.year ?? null,
    modifiedAt: listing.version ? new Date(`${listing.version}Z`) : null,
    publishedAt: null,
  });
  if (year === null) {
    throw new Error(`no year found for ${listing.url}`);
  }
  return { year, month: dayMonth.month, day: dayMonth.day };
}

function isoToParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

/** German and English live under a path prefix; French is the site's default. */
function localizeUrl(url: string, language: string): string {
  if (language === 'fr') {
    return url;
  }
  const parsed = new URL(url);
  parsed.pathname = `/${language}${parsed.pathname}`;
  return parsed.toString();
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match ? match[1] : null;
}

function indexAfter(html: string, pattern: RegExp): number | null {
  const match = pattern.exec(html);
  return match ? match.index + match[0].length : null;
}

function indexOfAny(html: string, patterns: RegExp[], from: number): number | null {
  const rest = html.slice(from);
  let best: number | null = null;
  for (const pattern of patterns) {
    const match = pattern.exec(rest);
    if (match && (best === null || match.index < best)) {
      best = match.index;
    }
  }
  return best === null ? null : from + best;
}
