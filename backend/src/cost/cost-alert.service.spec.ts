import { describe, test, expect } from 'bun:test';
import { describeCostState, costReasonKey } from './cost-alert.service';
import { decideAlert, type AlertState } from '../admin/alert-decision';
import type { CostSnapshot } from './cost.types';

function snapshot(projectedMonthChf: number): CostSnapshot {
  return { projectedMonthChf } as CostSnapshot;
}

const HOUR = 60 * 60 * 1000;

describe('describeCostState', () => {
  test('under the ceiling needs no action', () => {
    expect(describeCostState(snapshot(40), 100).needsAction).toBe(false);
  });

  test('over the ceiling needs action and carries both figures', () => {
    const state = describeCostState(snapshot(140), 100);
    expect(state.needsAction).toBe(true);
    expect(state.reason).toEqual({ projectedChf: 140, ceilingChf: 100 });
  });

  test('exactly at the ceiling is not over it', () => {
    expect(describeCostState(snapshot(100), 100).needsAction).toBe(false);
  });

  test('an unset ceiling never fires — the alert is opt-in', () => {
    expect(describeCostState(snapshot(10_000), 0).needsAction).toBe(false);
  });
});

describe('cost alerting is edge-triggered', () => {
  const over = describeCostState(snapshot(140), 100);
  const under = describeCostState(snapshot(40), 100);

  test('mails once when spend first crosses the ceiling', () => {
    expect(decideAlert(null, over, Date.now(), 168 * HOUR, costReasonKey)).toEqual({
      send: true,
      kind: 'problem',
      reason: over.reason,
    });
  });

  test('stays quiet while the same overspend persists', () => {
    const previous: AlertState = {
      needsAction: true,
      reasonKey: costReasonKey(over.reason),
      notifiedAt: new Date().toISOString(),
    };
    expect(decideAlert(previous, over, Date.now(), 168 * HOUR, costReasonKey)).toEqual({ send: false });
  });

  test('repeats once the re-alert interval has passed, so a missed mail is not the end of it', () => {
    const previous: AlertState = {
      needsAction: true,
      reasonKey: costReasonKey(over.reason),
      notifiedAt: new Date(Date.now() - 200 * HOUR).toISOString(),
    };
    const decision = decideAlert(previous, over, Date.now(), 168 * HOUR, costReasonKey);
    expect(decision.send).toBe(true);
  });

  test('says so when spend comes back down', () => {
    const previous: AlertState = {
      needsAction: true,
      reasonKey: costReasonKey(over.reason),
      notifiedAt: new Date().toISOString(),
    };
    expect(decideAlert(previous, under, Date.now(), 168 * HOUR, costReasonKey)).toEqual({
      send: true,
      kind: 'recovered',
      reason: null,
    });
  });

  test('never announces a recovery from a problem it never reported', () => {
    expect(decideAlert(null, under, Date.now(), 168 * HOUR, costReasonKey)).toEqual({ send: false });
  });

  test('a franc of drift is the same condition, not a new one', () => {
    expect(costReasonKey({ projectedChf: 140.2, ceilingChf: 100 })).toBe(
      costReasonKey({ projectedChf: 140.4, ceilingChf: 100 }),
    );
  });

  test('a materially worse overspend is reported again', () => {
    const previous: AlertState = {
      needsAction: true,
      reasonKey: costReasonKey({ projectedChf: 140, ceilingChf: 100 }),
      notifiedAt: new Date().toISOString(),
    };
    const worse = describeCostState(snapshot(400), 100);
    expect(decideAlert(previous, worse, Date.now(), 168 * HOUR, costReasonKey).send).toBe(true);
  });
});
