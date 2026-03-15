import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Spot } from '../spot/spot.entity';
import { DetectedItem } from '../spot/detected-item.entity';
import { User } from '../user/user.entity';
import { Team } from '../team/team.entity';
import { Cleanup } from '../cleanup/cleanup.entity';

interface TimeSeriesEntry {
  week: string;
  count: number;
}

interface WeightTimeSeriesEntry {
  week: string;
  total: number;
}

interface PublicStats {
  summary: {
    totalCleanups: number;
    totalUsers: number;
    totalTeams: number;
    totalSpots: number;
    totalItems: number;
    estimatedWeightGrams: number;
  };
  timeSeries: {
    spots: TimeSeriesEntry[];
    items: TimeSeriesEntry[];
    cleanups: TimeSeriesEntry[];
    estimatedWeightGrams: WeightTimeSeriesEntry[];
  };
  spotStats: {
    byStatus: { queued: number; processing: number; completed: number; failed: number };
    topCategories: Array<{ category: string; count: number }>;
    topMaterials: Array<{ material: string; count: number }>;
  };
}

@Injectable()
export class InsightsService {
  private readonly redis: Redis;
  private readonly cacheKey = 'insights:public-stats';
  private readonly cacheTtlSeconds = 300; // 5 minutes

  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
    @InjectRepository(DetectedItem)
    private readonly detectedItemRepository: Repository<DetectedItem>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(Cleanup)
    private readonly cleanupRepository: Repository<Cleanup>,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  async getPublicStats(): Promise<PublicStats> {
    const cached = await this.redis.get(this.cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const stats = await this.computeStats();
    await this.redis.set(this.cacheKey, JSON.stringify(stats), 'EX', this.cacheTtlSeconds);
    return stats;
  }

  private async computeStats(): Promise<PublicStats> {
    const [
      totalCleanups,
      totalUsers,
      totalTeams,
      totalSpots,
      totalItems,
      weightResult,
      spotsTimeSeries,
      itemsTimeSeries,
      cleanupsTimeSeries,
      weightTimeSeries,
      statusCounts,
      topCategories,
      topMaterials,
    ] = await Promise.all([
      this.cleanupRepository.count({ where: { archived_at: undefined } }).then((c) =>
        // TypeORM count with undefined where treats it as "no filter" — use query instead
        this.cleanupRepository.query(`SELECT COUNT(*)::int AS count FROM cleanups WHERE archived_at IS NULL`),
      ),
      this.userRepository.query(`SELECT COUNT(*)::int AS count FROM users WHERE last_login IS NOT NULL`),
      this.teamRepository.query(`SELECT COUNT(*)::int AS count FROM teams WHERE archived_at IS NULL`),
      this.spotRepository.query(`SELECT COUNT(*)::int AS count FROM spots`),
      this.detectedItemRepository.query(`SELECT COUNT(*)::int AS count FROM detected_items`),
      this.detectedItemRepository.query(`SELECT COALESCE(SUM(weight_grams), 0) AS total FROM detected_items`),
      this.spotRepository.query(
        `SELECT TO_CHAR(date_trunc('week', captured_at), 'YYYY-MM-DD') AS week, COUNT(*)::int AS count
         FROM spots GROUP BY date_trunc('week', captured_at) ORDER BY date_trunc('week', captured_at)`,
      ),
      this.detectedItemRepository.query(
        `SELECT TO_CHAR(date_trunc('week', s.captured_at), 'YYYY-MM-DD') AS week, COUNT(*)::int AS count
         FROM detected_items di JOIN spots s ON di.spot_id = s.id
         GROUP BY date_trunc('week', s.captured_at) ORDER BY date_trunc('week', s.captured_at)`,
      ),
      this.cleanupRepository.query(
        `SELECT TO_CHAR(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, COUNT(*)::int AS count
         FROM cleanups WHERE archived_at IS NULL
         GROUP BY date_trunc('week', created_at) ORDER BY date_trunc('week', created_at)`,
      ),
      this.detectedItemRepository.query(
        `SELECT TO_CHAR(date_trunc('week', s.captured_at), 'YYYY-MM-DD') AS week, COALESCE(SUM(di.weight_grams), 0) AS total
         FROM detected_items di JOIN spots s ON di.spot_id = s.id
         GROUP BY date_trunc('week', s.captured_at) ORDER BY date_trunc('week', s.captured_at)`,
      ),
      this.spotRepository.query(
        `SELECT processing_status, COUNT(*)::int AS count FROM spots GROUP BY processing_status`,
      ),
      this.detectedItemRepository.query(
        `SELECT category, COUNT(*)::int AS count FROM detected_items WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 10`,
      ),
      this.detectedItemRepository.query(
        `SELECT material, COUNT(*)::int AS count FROM detected_items WHERE material IS NOT NULL GROUP BY material ORDER BY count DESC LIMIT 10`,
      ),
    ]);

    const byStatus = { queued: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of statusCounts as Array<{ processing_status: keyof typeof byStatus; count: number }>) {
      if (row.processing_status in byStatus) {
        byStatus[row.processing_status] = Number(row.count);
      }
    }

    return {
      summary: {
        totalCleanups: Number(totalCleanups[0]?.count ?? 0),
        totalUsers: Number(totalUsers[0]?.count ?? 0),
        totalTeams: Number(totalTeams[0]?.count ?? 0),
        totalSpots: Number(totalSpots[0]?.count ?? 0),
        totalItems: Number(totalItems[0]?.count ?? 0),
        estimatedWeightGrams: Number(weightResult[0]?.total ?? 0),
      },
      timeSeries: {
        spots: (spotsTimeSeries as Array<{ week: string; count: number }>).map((r) => ({
          week: r.week,
          count: Number(r.count),
        })),
        items: (itemsTimeSeries as Array<{ week: string; count: number }>).map((r) => ({
          week: r.week,
          count: Number(r.count),
        })),
        cleanups: (cleanupsTimeSeries as Array<{ week: string; count: number }>).map((r) => ({
          week: r.week,
          count: Number(r.count),
        })),
        estimatedWeightGrams: (weightTimeSeries as Array<{ week: string; total: number }>).map((r) => ({
          week: r.week,
          total: Number(r.total),
        })),
      },
      spotStats: {
        byStatus,
        topCategories: (topCategories as Array<{ category: string; count: number }>).map((r) => ({
          category: r.category,
          count: Number(r.count),
        })),
        topMaterials: (topMaterials as Array<{ material: string; count: number }>).map((r) => ({
          material: r.material,
          count: Number(r.count),
        })),
      },
    };
  }
}
