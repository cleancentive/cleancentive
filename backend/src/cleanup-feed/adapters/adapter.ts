import type { Logger } from '@nestjs/common';
import type { CleanupFeed, CleanupFeedKind } from '../cleanup-feed.entity';

/**
 * One entry of a source's listing. Cheap to obtain — a listing page or an index
 * endpoint — and enough to decide whether the detail page is worth reading:
 * `startsOn` filters out what already happened, `version` what has not changed.
 */
export interface ExternalListing {
  /** Stable id within the source. */
  externalId: string;
  url: string;
  title: string;
  /** Opaque change marker; null means "always re-read the detail page". */
  version: string | null;
  /** 'YYYY-MM-DD' when the listing already reveals the date, else null. */
  startsOn: string | null;
}

/** A source event, normalised. Coordinates may be missing — the service geocodes. */
export interface ExternalCleanup {
  externalId: string;
  /** Without the feed's name prefix; the service applies that. */
  title: string;
  /** Plain text, paragraphs separated by blank lines. */
  body: string;
  url: string;
  registrationUrl: string | null;
  startAt: Date;
  endAt: Date;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  version: string | null;
}

export interface AdapterContext {
  now: Date;
  /** Paced, size-capped, content-type-checked. Adapters never call fetch directly. */
  fetchHtml(url: string): Promise<string>;
  fetchJson<T>(url: string): Promise<{ body: T; headers: Headers }>;
  logger: Pick<Logger, 'log' | 'warn'>;
}

/**
 * Reading a source happens in two steps so the service, not the adapter, decides
 * how many detail pages to fetch — which is what keeps a refresh polite.
 */
export interface FeedAdapter {
  readonly kind: CleanupFeedKind;
  list(feed: CleanupFeed, ctx: AdapterContext): Promise<ExternalListing[]>;
  fetchDetail(listing: ExternalListing, feed: CleanupFeed, ctx: AdapterContext): Promise<ExternalCleanup>;
}
