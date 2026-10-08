import { describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { Subject, firstValueFrom } from 'rxjs';
import type { SpotEvent } from '@cleancentive/shared';
import { InsightsController } from './insights.controller';

function makeController(enabled: boolean) {
  const events = new Subject<SpotEvent>();
  const controller = Object.create(InsightsController.prototype) as InsightsController;
  (controller as unknown as { insightsEvents: unknown }).insightsEvents = {
    enabled,
    stream: () => events.asObservable(),
  };
  return { controller, events };
}

const EVENT: SpotEvent = {
  type: 'spot.completed',
  spotId: 's1',
  teamId: 't1',
  cleanupId: null,
  cleanupDateId: null,
  capturedAt: '2026-10-31T10:00:00.000Z',
  latitude: 47.5,
  longitude: 7.6,
  pickedUp: true,
  subjectKind: 'litter',
  items: { count: 1, totalWeightGrams: 10, topObject: 'Can' },
  emittedAt: '2026-10-31T10:00:30.000Z',
};

describe('InsightsController.streamEvents', () => {
  test('is not there while the stream is switched off', () => {
    const { controller } = makeController(false);

    expect(() => controller.streamEvents()).toThrow(NotFoundException);
  });

  test('turns a spot event into a typed SSE message keyed by spot id', async () => {
    const { controller, events } = makeController(true);
    const first = firstValueFrom(controller.streamEvents('t1'));

    events.next(EVENT);

    const message = await first;
    expect(message.type).toBe('spot.completed');
    expect(message.id).toBe('s1');
    expect(message.data).toEqual(EVENT);
    expect(Object.keys(message.data as object)).not.toContain('userId');
  });
});
