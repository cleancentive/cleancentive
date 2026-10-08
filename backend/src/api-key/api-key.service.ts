import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { IsNull, Repository } from 'typeorm';
import { redisConnection } from '../common/redis-connection';
import { createRedisRateLimiter, type RedisRateLimiter } from '../common/redis-rate-limit';
import { generateSecretToken, hashSecretToken } from '../common/secret-token';
import { API_KEY_SCOPES, ApiKey, type ApiKeyScope } from './api-key.entity';

const NAME_MAX_LENGTH = 100;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const MAX_RATE_LIMIT_PER_MINUTE = 6000;
const DEFAULT_EXPIRY_DAYS = 365;
const MAX_EXPIRY_DAYS = 3650;
const LAST_USED_DEBOUNCE_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateApiKeyInput {
  name: string;
  contactEmail: string;
  scopes: ApiKeyScope[];
  rateLimitPerMinute?: number;
  /** Days until expiry; `null` means never. Defaults to a year. */
  expiresInDays?: number | null;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  rateLimitPerMinute: number;
  contactEmail: string;
  spotCount: number;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreatedApiKey extends Omit<ApiKeySummary, 'spotCount' | 'revokedAt'> {
  /** The full key. This is the only time it is ever returned. */
  key: string;
}

/** What a request learns about the key it carried. */
export interface ResolvedApiKey {
  id: string;
  name: string;
  scopes: ApiKeyScope[];
  rateLimitPerMinute: number;
}

@Injectable()
export class ApiKeyService {
  private readonly limiter: RedisRateLimiter;

  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
  ) {
    this.limiter = createRedisRateLimiter(new Redis({ ...redisConnection(), lazyConnect: true }), {
      windowMs: ONE_MINUTE_MS,
      message: 'This API key has used up its per-minute budget. Slow down and try again.',
    });
  }

  async create(input: CreateApiKeyInput, issuedByUserId: string): Promise<CreatedApiKey> {
    const name = validateName(input.name);
    const contactEmail = validateContactEmail(input.contactEmail);
    const scopes = validateScopes(input.scopes);
    const rateLimitPerMinute = validateRateLimit(input.rateLimitPerMinute);
    const expiresAt = resolveExpiry(input.expiresInDays);

    const secret = generateSecretToken('cc_live_');
    const saved = await this.apiKeyRepository.save(
      this.apiKeyRepository.create({
        name,
        contact_email: contactEmail,
        scopes,
        rate_limit_per_minute: rateLimitPerMinute,
        owner_user_id: issuedByUserId,
        key_prefix: secret.displayPrefix,
        key_hash: secret.hash,
        expires_at: expiresAt,
      }),
    );

    return {
      id: saved.id,
      name: saved.name,
      keyPrefix: saved.key_prefix,
      scopes: saved.scopes,
      rateLimitPerMinute: saved.rate_limit_per_minute,
      contactEmail: saved.contact_email,
      lastUsedAt: null,
      expiresAt: saved.expires_at,
      createdAt: saved.created_at,
      key: secret.plaintext,
    };
  }

  async list(): Promise<ApiKeySummary[]> {
    const rows: Array<ApiKey & { spot_count: number }> = await this.apiKeyRepository.query(
      `SELECT k.*, COUNT(s.id)::int AS spot_count
       FROM api_keys k
       LEFT JOIN spots s ON s.source_api_key_id = k.id
       GROUP BY k.id
       ORDER BY k.created_at DESC`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      scopes: row.scopes,
      rateLimitPerMinute: row.rate_limit_per_minute,
      contactEmail: row.contact_email,
      spotCount: row.spot_count,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    }));
  }

  async revoke(id: string): Promise<void> {
    const key = await this.apiKeyRepository.findOne({ where: { id, revoked_at: IsNull() } });
    if (!key) throw new NotFoundException('API key not found');
    await this.apiKeyRepository.update({ id }, { revoked_at: new Date() });
  }

  async authenticate(plaintext: string): Promise<ResolvedApiKey> {
    const key = await this.apiKeyRepository.findOne({ where: { key_hash: hashSecretToken(plaintext) } });
    const now = new Date();
    if (!key || key.revoked_at !== null || (key.expires_at !== null && key.expires_at <= now)) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    if (!key.last_used_at || now.getTime() - key.last_used_at.getTime() > LAST_USED_DEBOUNCE_MS) {
      await this.apiKeyRepository.update({ id: key.id }, { last_used_at: now });
    }

    return { id: key.id, name: key.name, scopes: key.scopes, rateLimitPerMinute: key.rate_limit_per_minute };
  }

  async enforceRateLimit(key: ResolvedApiKey): Promise<void> {
    await this.limiter.check(`api-key:${key.id}`, key.rateLimitPerMinute);
  }
}

function validateName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
    throw new BadRequestException(`name must be 1 to ${NAME_MAX_LENGTH} characters`);
  }
  return name;
}

function validateContactEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.trim() : '';
  if (!email.includes('@') || email.length > 255) {
    throw new BadRequestException('contactEmail must be an email address');
  }
  return email;
}

function validateScopes(raw: unknown): ApiKeyScope[] {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((scope) => (API_KEY_SCOPES as readonly string[]).includes(scope))) {
    throw new BadRequestException(`scopes must be a non-empty list drawn from: ${API_KEY_SCOPES.join(', ')}`);
  }
  return [...new Set(raw as ApiKeyScope[])];
}

function validateRateLimit(raw: number | undefined): number {
  const limit = raw ?? DEFAULT_RATE_LIMIT_PER_MINUTE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RATE_LIMIT_PER_MINUTE) {
    throw new BadRequestException(`rateLimitPerMinute must be an integer from 1 to ${MAX_RATE_LIMIT_PER_MINUTE}`);
  }
  return limit;
}

function resolveExpiry(expiresInDays: number | null | undefined): Date | null {
  if (expiresInDays === null) return null;
  const days = expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
    throw new BadRequestException(`expiresInDays must be an integer from 1 to ${MAX_EXPIRY_DAYS}, or null for no expiry`);
  }
  return new Date(Date.now() + days * DAY_MS);
}
