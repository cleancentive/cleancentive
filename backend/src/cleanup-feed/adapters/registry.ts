import type { CleanupFeedKind } from '../cleanup-feed.entity';
import type { FeedAdapter } from './adapter';
import { cleanuptourAdapter } from './cleanuptour.adapter';

export const FEED_ADAPTERS: Record<CleanupFeedKind, FeedAdapter> = {
  cleanuptour: cleanuptourAdapter,
};

export const CLEANUP_FEED_KINDS = Object.keys(FEED_ADAPTERS) as CleanupFeedKind[];

export function isCleanupFeedKind(value: unknown): value is CleanupFeedKind {
  return typeof value === 'string' && value in FEED_ADAPTERS;
}
