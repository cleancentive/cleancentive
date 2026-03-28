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

export interface PublicStats {
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
    topBrands: Array<{ brand: string; count: number }>;
  };
}

export interface StatsFilter {
  teamId?: string;
  cleanupDateId?: string;
  since?: string;
  pickedUp?: boolean;
  userId?: string;
}

@Injectable()
export class InsightsService {
  private readonly redis: Redis;
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

  async getMapData(filter: StatsFilter = {}) {
    const cacheKey = this.buildMapCacheKey(filter);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const { where, params } = this.buildSpotWhere(filter);
    const { and, params: andParams } = this.buildSpotAnd(filter);

    const [spotRows, cleanupRows] = await Promise.all([
      this.spotRepository.query(
        `SELECT s.id, s.longitude, s.latitude, s.captured_at, s.processing_status, s.picked_up,
                COUNT(di.id)::int AS item_count,
                (SELECT di2.category FROM detected_items di2
                 WHERE di2.spot_id = s.id ORDER BY di2.weight_grams DESC NULLS LAST LIMIT 1) AS top_category
         FROM spots s
         LEFT JOIN detected_items di ON di.spot_id = s.id
         ${where}
         GROUP BY s.id
         ORDER BY s.captured_at DESC
         LIMIT 5000`,
        params,
      ),
      this.spotRepository.query(
        `SELECT cd.id, cd.longitude, cd.latitude, cd.location_name,
                c.name AS cleanup_name, cd.start_at,
                COUNT(s.id)::int AS spot_count
         FROM cleanup_dates cd
         JOIN cleanups c ON c.id = cd.cleanup_id AND c.archived_at IS NULL
         LEFT JOIN spots s ON s.cleanup_date_id = cd.id ${and}
         WHERE cd.latitude IS NOT NULL
         GROUP BY cd.id, cd.longitude, cd.latitude, cd.location_name, c.name, cd.start_at`,
        andParams,
      ),
    ]);

    const spots = {
      type: 'FeatureCollection',
      features: spotRows.map((r: any) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [Number(r.longitude), Number(r.latitude)] },
        properties: {
          id: r.id,
          capturedAt: r.captured_at,
          itemCount: Number(r.item_count),
          topCategory: r.top_category,
          status: r.processing_status,
          pickedUp: r.picked_up,
        },
      })),
    };

    const cleanupLocations = {
      type: 'FeatureCollection',
      features: cleanupRows.map((r: any) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [Number(r.longitude), Number(r.latitude)] },
        properties: {
          id: r.id,
          cleanupName: r.cleanup_name,
          locationName: r.location_name,
          startAt: r.start_at,
          spotCount: Number(r.spot_count),
        },
      })),
    };

    const result = { spots, cleanupLocations };
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', this.cacheTtlSeconds);
    return result;
  }

  async getPublicStats(filter: StatsFilter = {}): Promise<PublicStats> {
    const cacheKey = this.buildCacheKey(filter);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const stats = await this.computeStats(filter);
    await this.redis.set(cacheKey, JSON.stringify(stats), 'EX', this.cacheTtlSeconds);
    return stats;
  }

  private buildCacheKey(filter: StatsFilter): string {
    const parts = ['insights:stats'];
    if (filter.teamId) parts.push(`t:${filter.teamId}`);
    if (filter.cleanupDateId) parts.push(`cd:${filter.cleanupDateId}`);
    if (filter.since) parts.push(`s:${filter.since}`);
    if (filter.pickedUp !== undefined) parts.push(`pu:${filter.pickedUp}`);
    if (filter.userId) parts.push(`u:${filter.userId}`);
    return parts.join(':');
  }

  private buildMapCacheKey(filter: StatsFilter): string {
    const parts = ['insights:map'];
    if (filter.teamId) parts.push(`t:${filter.teamId}`);
    if (filter.cleanupDateId) parts.push(`cd:${filter.cleanupDateId}`);
    if (filter.since) parts.push(`s:${filter.since}`);
    if (filter.pickedUp !== undefined) parts.push(`pu:${filter.pickedUp}`);
    if (filter.userId) parts.push(`u:${filter.userId}`);
    return parts.join(':');
  }

  private buildSpotWhere(filter: StatsFilter, alias = 's'): { where: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (filter.teamId) {
      conditions.push(`${alias}.team_id = $${idx++}`);
      params.push(filter.teamId);
    }
    if (filter.cleanupDateId) {
      conditions.push(`${alias}.cleanup_date_id = $${idx++}`);
      params.push(filter.cleanupDateId);
    }
    if (filter.since) {
      conditions.push(`${alias}.captured_at >= $${idx++}`);
      params.push(filter.since);
    }
    if (filter.pickedUp !== undefined) {
      conditions.push(`${alias}.picked_up = $${idx++}`);
      params.push(filter.pickedUp);
    }
    if (filter.userId) {
      conditions.push(`${alias}.user_id = $${idx++}`);
      params.push(filter.userId);
    }
    return {
      where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
      params,
    };
  }

  private buildSpotAnd(filter: StatsFilter, alias = 's'): { and: string; params: any[]; nextIdx: number } {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (filter.teamId) {
      conditions.push(`${alias}.team_id = $${idx++}`);
      params.push(filter.teamId);
    }
    if (filter.cleanupDateId) {
      conditions.push(`${alias}.cleanup_date_id = $${idx++}`);
      params.push(filter.cleanupDateId);
    }
    if (filter.since) {
      conditions.push(`${alias}.captured_at >= $${idx++}`);
      params.push(filter.since);
    }
    if (filter.pickedUp !== undefined) {
      conditions.push(`${alias}.picked_up = $${idx++}`);
      params.push(filter.pickedUp);
    }
    if (filter.userId) {
      conditions.push(`${alias}.user_id = $${idx++}`);
      params.push(filter.userId);
    }
    return {
      and: conditions.length ? 'AND ' + conditions.join(' AND ') : '',
      params,
      nextIdx: idx,
    };
  }

  private hasFilter(filter: StatsFilter): boolean {
    return !!(filter.teamId || filter.cleanupDateId || filter.since || filter.pickedUp !== undefined || filter.userId);
  }

  private async computeStats(filter: StatsFilter = {}): Promise<PublicStats> {
    if (!this.hasFilter(filter)) {
      return this.computeGlobalStats();
    }
    return this.computeFilteredStats(filter);
  }

  private async computeGlobalStats(): Promise<PublicStats> {
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
      topBrands,
    ] = await Promise.all([
      this.cleanupRepository.count({ where: { archived_at: undefined } }).then((c) =>
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
      this.detectedItemRepository.query(
        `SELECT brand, COUNT(*)::int AS count FROM detected_items WHERE brand IS NOT NULL GROUP BY brand ORDER BY count DESC LIMIT 10`,
      ),
    ]);

    return this.formatStats(
      totalCleanups, totalUsers, totalTeams, totalSpots, totalItems, weightResult,
      spotsTimeSeries, itemsTimeSeries, cleanupsTimeSeries, weightTimeSeries,
      statusCounts, topCategories, topMaterials, topBrands,
    );
  }

  private async computeFilteredStats(filter: StatsFilter): Promise<PublicStats> {
    const { where, params } = this.buildSpotWhere(filter);
    const { and, params: andParams } = this.buildSpotAnd(filter);

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
      topBrands,
    ] = await Promise.all([
      // When filtered, derive counts from spots table
      this.spotRepository.query(
        `SELECT COUNT(DISTINCT cd.cleanup_id)::int AS count
         FROM spots s JOIN cleanup_dates cd ON cd.id = s.cleanup_date_id ${where}`,
        params,
      ),
      this.spotRepository.query(
        `SELECT COUNT(DISTINCT s.user_id)::int AS count FROM spots s ${where}`,
        params,
      ),
      this.spotRepository.query(
        `SELECT COUNT(DISTINCT s.team_id)::int AS count FROM spots s ${where}`,
        params,
      ),
      this.spotRepository.query(
        `SELECT COUNT(*)::int AS count FROM spots s ${where}`,
        params,
      ),
      this.spotRepository.query(
        `SELECT COUNT(*)::int AS count FROM detected_items di JOIN spots s ON di.spot_id = s.id ${where}`,
        params,
      ),
      this.spotRepository.query(
        `SELECT COALESCE(SUM(di.weight_grams), 0) AS total FROM detected_items di JOIN spots s ON di.spot_id = s.id ${where}`,
        params,
      ),
      this.spotRepository.query(
        `SELECT TO_CHAR(date_trunc('week', s.captured_at), 'YYYY-MM-DD') AS week, COUNT(*)::int AS count
         FROM spots s ${where}
         GROUP BY date_trunc('week', s.captured_at) ORDER BY date_trunc('week', s.captured_at)`,
        params,
      ),
      this.spotRepository.query(
        `SELECT TO_CHAR(date_trunc('week', s.captured_at), 'YYYY-MM-DD') AS week, COUNT(*)::int AS count
         FROM detected_items di JOIN spots s ON di.spot_id = s.id ${where}
         GROUP BY date_trunc('week', s.captured_at) ORDER BY date_trunc('week', s.captured_at)`,
        params,
      ),
      // Cleanups time series: derive from spots when filtered
      this.spotRepository.query(
        `SELECT TO_CHAR(date_trunc('week', s.captured_at), 'YYYY-MM-DD') AS week,
                COUNT(DISTINCT cd.cleanup_id)::int AS count
         FROM spots s JOIN cleanup_dates cd ON cd.id = s.cleanup_date_id ${where}
         GROUP BY date_trunc('week', s.captured_at) ORDER BY date_trunc('week', s.captured_at)`,
        params,
      ),
      this.spotRepository.query(
        `SELECT TO_CHAR(date_trunc('week', s.captured_at), 'YYYY-MM-DD') AS week, COALESCE(SUM(di.weight_grams), 0) AS total
         FROM detected_items di JOIN spots s ON di.spot_id = s.id ${where}
         GROUP BY date_trunc('week', s.captured_at) ORDER BY date_trunc('week', s.captured_at)`,
        params,
      ),
      this.spotRepository.query(
        `SELECT s.processing_status, COUNT(*)::int AS count FROM spots s ${where} GROUP BY s.processing_status`,
        params,
      ),
      this.spotRepository.query(
        `SELECT di.category, COUNT(*)::int AS count
         FROM detected_items di JOIN spots s ON di.spot_id = s.id
         ${where ? where + ' AND di.category IS NOT NULL' : 'WHERE di.category IS NOT NULL'}
         GROUP BY di.category ORDER BY count DESC LIMIT 10`,
        params,
      ),
      this.spotRepository.query(
        `SELECT di.material, COUNT(*)::int AS count
         FROM detected_items di JOIN spots s ON di.spot_id = s.id
         ${where ? where + ' AND di.material IS NOT NULL' : 'WHERE di.material IS NOT NULL'}
         GROUP BY di.material ORDER BY count DESC LIMIT 10`,
        params,
      ),
      this.spotRepository.query(
        `SELECT di.brand, COUNT(*)::int AS count
         FROM detected_items di JOIN spots s ON di.spot_id = s.id
         ${where ? where + ' AND di.brand IS NOT NULL' : 'WHERE di.brand IS NOT NULL'}
         GROUP BY di.brand ORDER BY count DESC LIMIT 10`,
        params,
      ),
    ]);

    return this.formatStats(
      totalCleanups, totalUsers, totalTeams, totalSpots, totalItems, weightResult,
      spotsTimeSeries, itemsTimeSeries, cleanupsTimeSeries, weightTimeSeries,
      statusCounts, topCategories, topMaterials, topBrands,
    );
  }

  private formatStats(
    totalCleanups: any[], totalUsers: any[], totalTeams: any[],
    totalSpots: any[], totalItems: any[], weightResult: any[],
    spotsTimeSeries: any[], itemsTimeSeries: any[], cleanupsTimeSeries: any[],
    weightTimeSeries: any[], statusCounts: any[], topCategories: any[], topMaterials: any[],
    topBrands: any[],
  ): PublicStats {
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
        topBrands: (topBrands as Array<{ brand: string; count: number }>).map((r) => ({
          brand: r.brand,
          count: Number(r.count),
        })),
      },
    };
  }
}
