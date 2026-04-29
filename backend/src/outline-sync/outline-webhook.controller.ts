import {
  Controller,
  Post,
  Req,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OutlineWebhookConfig } from './outline-webhook-config.entity';
import { OutlineEvent } from './outline-event.entity';

interface OutlineWebhookPayload {
  id?: string;
  event?: string;
  actorId?: string;
  payload?: { id?: string; collectionId?: string; documentId?: string; [k: string]: unknown };
  [k: string]: unknown;
}

@Controller('outline-webhooks')
@ApiTags('outline-webhooks')
export class OutlineWebhookController {
  private readonly logger = new Logger(OutlineWebhookController.name);

  constructor(
    @InjectRepository(OutlineWebhookConfig)
    private readonly configRepo: Repository<OutlineWebhookConfig>,
    @InjectRepository(OutlineEvent)
    private readonly eventRepo: Repository<OutlineEvent>,
  ) {}

  @Post('incoming')
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<{ ok: true }> {
    const signatureHeader = req.headers['outline-signature'];
    if (typeof signatureHeader !== 'string') {
      throw new HttpException('Missing Outline-Signature header', HttpStatus.UNAUTHORIZED);
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new HttpException('Missing request body', HttpStatus.BAD_REQUEST);
    }

    const config = await this.configRepo.findOne({ where: {}, order: { created_at: 'ASC' } });
    if (!config) {
      this.logger.warn('Webhook arrived but no secret is configured yet — rejecting');
      throw new HttpException('Webhook receiver not initialised', HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (!this.verifySignature(signatureHeader, rawBody, config.secret)) {
      throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
    }

    let body: OutlineWebhookPayload;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new HttpException('Invalid JSON', HttpStatus.BAD_REQUEST);
    }

    await this.eventRepo.save(
      this.eventRepo.create({
        event_type: body.event ?? 'unknown',
        actor_id: body.actorId ?? null,
        document_id: (body.payload?.documentId as string) ?? (body.event?.startsWith('documents.') ? (body.payload?.id as string) : null) ?? null,
        collection_id: (body.payload?.collectionId as string) ?? (body.event?.startsWith('collections.') ? (body.payload?.id as string) : null) ?? null,
        payload: body as Record<string, unknown>,
      }),
    );

    return { ok: true };
  }

  /** Outline format: `t=<unix_ms>,s=<sha256_hex_of_${t}.${body}>`. */
  private verifySignature(headerValue: string, rawBody: Buffer, secret: string): boolean {
    const parts = headerValue.split(',').reduce<Record<string, string>>((acc, kv) => {
      const [k, v] = kv.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});
    const t = parts.t;
    const s = parts.s;
    if (!t || !s) return false;

    const expected = createHmac('sha256', secret)
      .update(`${t}.${rawBody.toString('utf8')}`)
      .digest('hex');

    if (expected.length !== s.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(s, 'hex'));
    } catch {
      return false;
    }
  }
}
