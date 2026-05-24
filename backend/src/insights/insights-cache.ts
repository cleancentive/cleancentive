import type Redis from 'ioredis';

export async function clearInsightsCache(redis: Redis): Promise<void> {
  const keys = await redis.keys('insights:*');
  if (keys.length > 0) {
    await redis.del(keys);
  }
}
