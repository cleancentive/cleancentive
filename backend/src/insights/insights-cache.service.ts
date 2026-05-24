import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConnection } from '../common/redis-connection';
import { clearInsightsCache } from './insights-cache';

@Injectable()
export class InsightsCacheService implements OnModuleDestroy {
  private readonly redis = new Redis(redisConnection());

  async invalidate(): Promise<void> {
    await clearInsightsCache(this.redis);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
