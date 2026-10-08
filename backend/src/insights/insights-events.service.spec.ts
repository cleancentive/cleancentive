import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { Subject } from 'rxjs';
import type { SpotEvent } from '@cleancentive/shared';
import { InsightsEventsService, matchesSpotEventFilter } from './insights-events.service';

const EVENT: SpotEvent = {
  type: 'spot.completed',
  spotId: 's1',
  teamId: 't1',
  cleanupId: 'c1',
  cleanupDateId: 'd1',
  capturedAt: '2026-10-31T10:00:00.000Z',
  latitude: 47.5,
  longitude: 7.6,
  pickedUp: true,
  subjectKind: 'litter',
  items: { count: 1, totalWeightGrams: 10, topObject: 'Can' },
  emittedAt: '2026-10-31T10:00:30.000Z',
};

describe('matchesSpotEventFilter', () => {
  test.each([
    [{}, true],
    [{ teamId: 't1' }, true],
    [{ teamId: 'other' }, false],
    [{ cleanupId: 'c1' }, true],
    [{ cleanupId: 'other' }, false],
    [{ cleanupDateId: 'd1' }, true],
    [{ cleanupDateId: 'other', cleanupId: 'c1' }, false],
    [{ teamId: 't1', cleanupId: 'c1' }, true],
    [{ teamId: 'other', cleanupId: 'c1' }, false],
  ])('%j → %s', (criteria, expected) => {
    expect(matchesSpotEventFilter(EVENT, criteria)).toBe(expected);
  });
});

function makeService(enabled: boolean) {
  const unlinked: string[] = [];
  const published: string[] = [];
  const service = Object.create(InsightsEventsService.prototype) as InsightsEventsService;
  const inject = service as unknown as Record<string, unknown>;
  inject.enabled = enabled;
  inject.logger = { warn: () => undefined };
  inject.events = new Subject<SpotEvent>();
  inject.publisher = {
    scanStream: () => Readable.from([['insights:stats:x']]),
    unlink: async (...keys: string[]) => { unlinked.push(...keys); return keys.length; },
    publish: async (_channel: string, raw: string) => { published.push(raw); return 1; },
  };
  const onMessage = (raw: string) => (service as unknown as { onMessage: (r: string) => Promise<void> }).onMessage(raw);
  return { service, unlinked, published, onMessage };
}

describe('InsightsEventsService', () => {
  test('clears the insights cache and fans the event out when enabled', async () => {
    const { service, unlinked, onMessage } = makeService(true);
    const received: SpotEvent[] = [];
    service.stream({ teamId: 't1' }).subscribe((event) => received.push(event));

    await onMessage(JSON.stringify(EVENT));

    expect(unlinked).toEqual(['insights:stats:x']);
    expect(received).toEqual([EVENT]);
  });

  test('still clears the cache when fan-out is switched off', async () => {
    const { service, unlinked, onMessage } = makeService(false);
    const received: SpotEvent[] = [];
    service.stream({}).subscribe((event) => received.push(event));

    await onMessage(JSON.stringify(EVENT));

    expect(unlinked).toEqual(['insights:stats:x']);
    expect(received).toEqual([]);
  });

  test('ignores a malformed message', async () => {
    const { unlinked, onMessage } = makeService(true);

    await onMessage('not json');

    expect(unlinked).toEqual([]);
  });

  test('stamps and publishes an event from this process', async () => {
    const { service, published } = makeService(true);
    const { emittedAt: _ignored, ...unstamped } = EVENT;

    await service.publish(unstamped);

    const sent = JSON.parse(published[0]) as SpotEvent;
    expect(sent.spotId).toBe('s1');
    expect(typeof sent.emittedAt).toBe('string');
  });
});
