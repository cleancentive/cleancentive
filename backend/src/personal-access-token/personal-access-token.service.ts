import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { generateSecretToken, hashSecretToken } from '../common/secret-token';
import { PersonalAccessToken } from './personal-access-token.entity';

const NAME_MAX_LENGTH = 100;
const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 365;
const MAX_ACTIVE_TOKENS_PER_USER = 25;
// Every API call would otherwise write a row; once per few minutes is plenty
// for "is this token still in use".
const LAST_USED_DEBOUNCE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreatePersonalAccessTokenInput {
  name: string;
  /** Days until expiry; `null` means the token never expires. Defaults to 90. */
  expiresInDays?: number | null;
}

export interface PersonalAccessTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreatedPersonalAccessToken extends PersonalAccessTokenSummary {
  /** The full token. This is the only time it is ever returned. */
  token: string;
}

@Injectable()
export class PersonalAccessTokenService {
  constructor(
    @InjectRepository(PersonalAccessToken)
    private readonly tokenRepository: Repository<PersonalAccessToken>,
  ) {}

  async create(userId: string, input: CreatePersonalAccessTokenInput): Promise<CreatedPersonalAccessToken> {
    const name = validateName(input.name);
    const expiresAt = resolveExpiry(input.expiresInDays);

    const activeCount = await this.tokenRepository.count({ where: { user_id: userId, revoked_at: IsNull() } });
    if (activeCount >= MAX_ACTIVE_TOKENS_PER_USER) {
      throw new BadRequestException(`You already have ${MAX_ACTIVE_TOKENS_PER_USER} active tokens. Revoke one first.`);
    }

    const secret = generateSecretToken('cc_pat_');
    const saved = await this.tokenRepository.save(
      this.tokenRepository.create({
        user_id: userId,
        name,
        token_prefix: secret.displayPrefix,
        token_hash: secret.hash,
        expires_at: expiresAt,
      }),
    );

    return { ...toSummary(saved), token: secret.plaintext };
  }

  async list(userId: string): Promise<PersonalAccessTokenSummary[]> {
    const tokens = await this.tokenRepository.find({
      where: { user_id: userId, revoked_at: IsNull() },
      order: { created_at: 'DESC' },
    });
    return tokens.map(toSummary);
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const token = await this.tokenRepository.findOne({ where: { id: tokenId, user_id: userId, revoked_at: IsNull() } });
    if (!token) throw new NotFoundException('Access token not found');
    await this.tokenRepository.update({ id: token.id }, { revoked_at: new Date() });
  }

  async authenticate(plaintext: string): Promise<{ userId: string }> {
    const token = await this.tokenRepository.findOne({ where: { token_hash: hashSecretToken(plaintext) } });
    const now = new Date();
    if (!token || token.revoked_at !== null || (token.expires_at !== null && token.expires_at <= now)) {
      throw new UnauthorizedException('Invalid or revoked access token');
    }

    if (!token.last_used_at || now.getTime() - token.last_used_at.getTime() > LAST_USED_DEBOUNCE_MS) {
      await this.tokenRepository.update({ id: token.id }, { last_used_at: now });
    }

    return { userId: token.user_id };
  }

  // A person who leaves must not leave live credentials behind. Deletion
  // cascades through the foreign key; anonymisation keeps the row, so the
  // tokens have to be revoked explicitly.
  @OnEvent('user.anonymized')
  async handleUserAnonymized(payload: { userId: string }): Promise<void> {
    await this.tokenRepository.update({ user_id: payload.userId, revoked_at: IsNull() }, { revoked_at: new Date() });
  }
}

function validateName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
    throw new BadRequestException(`name must be 1 to ${NAME_MAX_LENGTH} characters`);
  }
  return name;
}

function resolveExpiry(expiresInDays: number | null | undefined): Date | null {
  if (expiresInDays === null) return null;
  const days = expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
    throw new BadRequestException(`expiresInDays must be an integer from 1 to ${MAX_EXPIRY_DAYS}, or null for no expiry`);
  }
  return new Date(Date.now() + days * DAY_MS);
}

function toSummary(token: PersonalAccessToken): PersonalAccessTokenSummary {
  return {
    id: token.id,
    name: token.name,
    tokenPrefix: token.token_prefix,
    lastUsedAt: token.last_used_at,
    expiresAt: token.expires_at,
    createdAt: token.created_at,
  };
}
