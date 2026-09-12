import { describe, expect, test } from 'bun:test';

import { decideAlert, describeActionableState, reasonKey, type AlertState } from './detection-alert.service';
import { emailStrings } from '../email/email.i18n';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-12T12:00:00.000Z');

function stateAt(offsetMs: number, overrides: Partial<AlertState> = {}): AlertState {
  return {
    needsAction: true,
    reasonKey: 'worker-down',
    notifiedAt: new Date(NOW - offsetMs).toISOString(),
    ...overrides,
  };
}

const broken = { needsAction: true, reason: { kind: 'worker-down' } } as const;
const healthy = { needsAction: false, reason: null } as const;

describe('decideAlert', () => {
  test('mails once when a problem first appears', () => {
    expect(decideAlert(null, broken, NOW, DAY)).toEqual({
      send: true,
      kind: 'problem',
      reason: { kind: 'worker-down' },
    });
  });

  test('stays silent while the same problem persists', () => {
    // The whole point of edge-triggering: a standing problem must not turn into
    // an inbox full of identical warnings every 5 minutes.
    expect(decideAlert(stateAt(HOUR), broken, NOW, DAY)).toEqual({ send: false });
  });

  test('repeats once the re-alert interval has elapsed', () => {
    // September ran nine days unnoticed. One missed or filtered mail would
    // reproduce exactly that silence, so a standing problem repeats daily.
    expect(decideAlert(stateAt(25 * HOUR), broken, NOW, DAY)).toMatchObject({
      send: true,
      kind: 'problem',
    });
  });

  test('never repeats when the interval is disabled', () => {
    expect(decideAlert(stateAt(365 * DAY), broken, NOW, 0)).toEqual({ send: false });
  });

  test('reports a changed reason immediately as a new occurrence', () => {
    const changed = { needsAction: true, reason: { kind: 'retryable-failed', count: 3 } } as const;
    expect(decideAlert(stateAt(HOUR), changed, NOW, DAY)).toMatchObject({
      send: true,
      reason: { kind: 'retryable-failed', count: 3 },
    });
  });

  test('mails once on recovery', () => {
    expect(decideAlert(stateAt(HOUR), healthy, NOW, DAY)).toMatchObject({
      send: true,
      kind: 'recovered',
    });
  });

  test('stays silent when healthy and nothing was ever reported', () => {
    expect(decideAlert(null, healthy, NOW, DAY)).toEqual({ send: false });
    expect(decideAlert(stateAt(HOUR, { needsAction: false, reasonKey: '' }), healthy, NOW, DAY)).toEqual({
      send: false,
    });
  });
});

describe('describeActionableState', () => {
  function overview(patch: {
    healthy?: boolean;
    retryableFailed?: number;
    stalled?: number;
  }) {
    return {
      worker: { healthy: patch.healthy ?? true },
      spots: { retryableFailed: patch.retryableFailed ?? 0, stalled: patch.stalled ?? 0 },
    } as any;
  }

  test('flags an unhealthy worker', () => {
    expect(describeActionableState(overview({ healthy: false }))).toMatchObject({ needsAction: true });
  });

  test('flags retryable failed spots and stalled spots', () => {
    expect(describeActionableState(overview({ retryableFailed: 2 })).reason).toEqual({
      kind: 'retryable-failed',
      count: 2,
    });
    expect(describeActionableState(overview({ stalled: 5 })).reason).toEqual({ kind: 'stalled', count: 5 });
  });

  test('is quiet when nothing is actionable', () => {
    // Mirrors getOverallHealthStatus on purpose: the mail and the badge must
    // never disagree about whether there is a problem.
    expect(describeActionableState(overview({}))).toEqual({ needsAction: false, reason: null });
  });
});

describe('alert reason localization', () => {
  test('renders the reason in the recipient language, not just the chrome', () => {
    // Regression caught in dev: the mail chrome rendered in German while the
    // reason line stayed English, because describeActionableState formatted the
    // text itself. The reason is structured now so each locale can render it.
    const reason = { kind: 'retryable-failed', count: 3 } as const;
    expect(emailStrings('de').detectionAlert.reason(reason)).toContain('erneut versuchen');
    expect(emailStrings('fr').detectionAlert.reason(reason)).toContain('relancés');
    expect(emailStrings('en').detectionAlert.reason(reason)).toContain('can be retried');
    expect(emailStrings('de').detectionAlert.reason({ kind: 'worker-down' })).toContain('Heartbeat');
  });
});

describe('reasonKey', () => {
  test('distinguishes conditions and counts so a changed problem re-alerts', () => {
    expect(reasonKey({ kind: 'worker-down' })).toBe('worker-down');
    expect(reasonKey({ kind: 'stalled', count: 2 })).not.toBe(reasonKey({ kind: 'stalled', count: 3 }));
    expect(reasonKey(null)).toBe('');
  });
});
