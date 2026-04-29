import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import {
  ClientEventPayload,
  ClientEventType,
  ClientEventsService,
  IdentityHint,
} from './client-events.service';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 60;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const VALID_EVENT_TYPES: ClientEventType[] = [
  'pick.upload.failed',
  'pick.upload.skipped.identity-mismatch',
];

const VALID_IDENTITY_HINTS: IdentityHint[] = [
  'matches',
  'mismatch',
  'no-current-identity',
];

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'eventType',
  'occurredAt',
  'itemId',
  'attempts',
  'ageMs',
  'status',
  'message',
  'identityHint',
  'guestId',
]);

const MAX_BODY_BYTES = 1024;
const MAX_MESSAGE_LENGTH = 256;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawBody {
  eventType?: unknown;
  occurredAt?: unknown;
  itemId?: unknown;
  attempts?: unknown;
  ageMs?: unknown;
  status?: unknown;
  message?: unknown;
  identityHint?: unknown;
  guestId?: unknown;
}

function checkRateLimit(key: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    throw new HttpException(
      'Too many client events. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  entry.count++;
}

function validatePayload(body: RawBody): ClientEventPayload {
  for (const key of Object.keys(body ?? {})) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new BadRequestException(`unexpected field: ${key}`);
    }
  }

  if (!VALID_EVENT_TYPES.includes(body.eventType as ClientEventType)) {
    throw new BadRequestException('eventType must be a known client event type');
  }
  const eventType = body.eventType as ClientEventType;

  if (typeof body.occurredAt !== 'string' || Number.isNaN(Date.parse(body.occurredAt))) {
    throw new BadRequestException('occurredAt must be a valid ISO timestamp');
  }

  if (typeof body.itemId !== 'string' || !UUID_REGEX.test(body.itemId)) {
    throw new BadRequestException('itemId must be a UUID');
  }

  if (
    typeof body.attempts !== 'number' ||
    !Number.isInteger(body.attempts) ||
    body.attempts < 0
  ) {
    throw new BadRequestException('attempts must be a non-negative integer');
  }

  if (
    typeof body.ageMs !== 'number' ||
    !Number.isInteger(body.ageMs) ||
    body.ageMs < 0
  ) {
    throw new BadRequestException('ageMs must be a non-negative integer');
  }

  const payload: ClientEventPayload = {
    eventType,
    occurredAt: body.occurredAt,
    itemId: body.itemId,
    attempts: body.attempts,
    ageMs: body.ageMs,
  };

  if (eventType === 'pick.upload.failed') {
    if (body.status !== null && body.status !== undefined) {
      if (
        typeof body.status !== 'number' ||
        !Number.isInteger(body.status) ||
        body.status < 0 ||
        body.status > 599
      ) {
        throw new BadRequestException('status must be a valid HTTP status integer');
      }
      payload.status = body.status;
    } else {
      payload.status = null;
    }
    if (body.message !== undefined) {
      if (typeof body.message !== 'string') {
        throw new BadRequestException('message must be a string');
      }
      payload.message = body.message.slice(0, MAX_MESSAGE_LENGTH);
    }
    if (body.identityHint !== undefined) {
      throw new BadRequestException('identityHint is not allowed for pick.upload.failed');
    }
  } else if (eventType === 'pick.upload.skipped.identity-mismatch') {
    if (!VALID_IDENTITY_HINTS.includes(body.identityHint as IdentityHint)) {
      throw new BadRequestException('identityHint must be matches | mismatch | no-current-identity');
    }
    payload.identityHint = body.identityHint as IdentityHint;
    if (body.status !== undefined || body.message !== undefined) {
      throw new BadRequestException('status/message are not allowed for identity-mismatch events');
    }
  }

  return payload;
}

@Controller('client-events')
@ApiBearerAuth('Bearer')
@ApiTags('client-events')
export class ClientEventsController {
  constructor(private readonly service: ClientEventsService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Receive a narrowly-scoped diagnostic event from the client when an upload has failed persistently. Body is rejected if it carries unknown fields.',
  })
  async create(@Request() req: any, @Body() body: RawBody) {
    const rawSize = Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
    if (rawSize > MAX_BODY_BYTES) {
      throw new BadRequestException('payload exceeds 1 KB');
    }

    const payload = validatePayload(body);

    const userId: string | undefined = req.user?.userId;
    const guestId =
      typeof body.guestId === 'string' && body.guestId.length > 0 ? body.guestId : undefined;

    const identity = userId
      ? `user:${userId}`
      : guestId
        ? `guest:${guestId}`
        : 'anonymous';

    const rateLimitKey = userId || guestId || req.ip || 'anonymous';
    checkRateLimit(rateLimitKey);

    this.service.record({ ...payload, identity });

    return { accepted: true };
  }
}
