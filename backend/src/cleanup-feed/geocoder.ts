import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { isValidLatLng } from '@cleancentive/shared';
import { redisConnection } from '../common/redis-connection';
import { RequestPacer } from './fetch-page';

const GEO_ADMIN_URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'CleanCentive-Feeds/1.0 (+https://cleancentive.org)';
const TIMEOUT_MS = 5_000;
const HIT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MISS_TTL_SECONDS = 24 * 60 * 60;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

interface GeoAdminResponse {
  results?: Array<{ attrs?: { lat?: number; lon?: number } }>;
}

type NominatimResponse = Array<{ lat?: string; lon?: string }>;

/**
 * Turns a source's postal address into coordinates. Swisstopo first — every
 * source we mirror so far is Swiss and it answers street addresses precisely —
 * then Nominatim for anything it does not know, such as a mountain pass.
 *
 * Results are cached because addresses repeat across refreshes and both
 * services are free ones we should lean on lightly.
 */
@Injectable()
export class Geocoder {
  private readonly logger = new Logger(Geocoder.name);
  private readonly redis: Redis;
  private readonly pacer: RequestPacer;

  constructor(private readonly fetchImpl: typeof fetch = fetch, redis?: Redis, pacer?: RequestPacer) {
    this.redis = redis ?? new Redis(redisConnection());
    this.pacer = pacer ?? new RequestPacer(1000);
  }

  async locate(address: string): Promise<Coordinates | null> {
    const key = `cleanup-feed:geocode:${address.toLowerCase().trim()}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached !== null) {
      return cached === '' ? null : (JSON.parse(cached) as Coordinates);
    }

    const found = (await this.fromGeoAdmin(address)) ?? (await this.fromNominatim(address));

    await this.redis
      .set(key, found ? JSON.stringify(found) : '', 'EX', found ? HIT_TTL_SECONDS : MISS_TTL_SECONDS)
      .catch(() => undefined);

    return found;
  }

  private async fromGeoAdmin(address: string): Promise<Coordinates | null> {
    const url = `${GEO_ADMIN_URL}?searchText=${encodeURIComponent(address)}&type=locations&sr=4326&limit=1`;
    const body = await this.getJson<GeoAdminResponse>(url);
    const attrs = body?.results?.[0]?.attrs;
    return this.validate(attrs?.lat, attrs?.lon);
  }

  private async fromNominatim(address: string): Promise<Coordinates | null> {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=jsonv2&limit=1`;
    const body = await this.getJson<NominatimResponse>(url);
    const first = body?.[0];
    return this.validate(first?.lat === undefined ? undefined : Number(first.lat), first?.lon === undefined ? undefined : Number(first.lon));
  }

  private validate(latitude: unknown, longitude: unknown): Coordinates | null {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!isValidLatLng(lat, lon)) {
      return null;
    }
    return { latitude: lat, longitude: lon };
  }

  /** A geocoder that is down must not fail the refresh — the address is reported instead. */
  private async getJson<T>(url: string): Promise<T | null> {
    await this.pacer.wait();
    try {
      const response = await this.fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Geocoder ${new URL(url).host} returned ${response.status}`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(`Geocoder ${new URL(url).host} failed: ${(error as Error).message}`);
      return null;
    }
  }
}
