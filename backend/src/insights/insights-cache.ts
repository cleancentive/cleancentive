import type Redis from 'ioredis';

const INSIGHTS_KEY_PATTERN = 'insights:*';
const SCAN_BATCH_SIZE = 200;

// SCAN rather than KEYS: this runs on every spot save and every detection
// result, and KEYS blocks Redis while it walks the whole keyspace, BullMQ's
// included. UNLINK frees the memory off the main thread for the same reason.
export async function clearInsightsCache(redis: Redis): Promise<void> {
  const scan = redis.scanStream({ match: INSIGHTS_KEY_PATTERN, count: SCAN_BATCH_SIZE });
  for await (const batch of scan as AsyncIterable<string[]>) {
    if (batch.length > 0) await redis.unlink(...batch);
  }
}
