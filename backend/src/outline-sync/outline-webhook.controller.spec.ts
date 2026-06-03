import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import { OutlineWebhookController } from './outline-webhook.controller';

// The webhook secret is the same plaintext hex string we persist in
// outline_webhook_config and hand to Outline's webhookSubscriptions API.
// Outline signs deliveries with `createHmac('sha256', secret)` over
// `${timestamp}.${payload}`; this verifies our receiver accepts that exact
// scheme and rejects anything else.
describe('OutlineWebhookController signature verification', () => {
  const secret = 'a'.repeat(64);
  const controller = new OutlineWebhookController({} as any, {} as any) as any;

  function sign(payload: string, t = '1700000000000', key = secret): string {
    const s = createHmac('sha256', key).update(`${t}.${payload}`).digest('hex');
    return `t=${t},s=${s}`;
  }

  test('accepts a signature produced with the shared secret', () => {
    const body = Buffer.from(JSON.stringify({ event: 'documents.update' }), 'utf8');
    const header = sign(body.toString('utf8'));
    expect(controller.verifySignature(header, body, secret)).toBe(true);
  });

  test('rejects a tampered body', () => {
    const body = Buffer.from(JSON.stringify({ event: 'documents.update' }), 'utf8');
    const header = sign('a different payload');
    expect(controller.verifySignature(header, body, secret)).toBe(false);
  });

  test('rejects a signature signed with the wrong secret', () => {
    const payload = 'payload';
    const body = Buffer.from(payload, 'utf8');
    const header = sign(payload, '1700000000000', 'b'.repeat(64));
    expect(controller.verifySignature(header, body, secret)).toBe(false);
  });

  test('rejects a malformed header', () => {
    expect(controller.verifySignature('nonsense', Buffer.from('x'), secret)).toBe(false);
  });
});
