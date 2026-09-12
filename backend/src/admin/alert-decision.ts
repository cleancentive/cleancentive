export interface AlertState {
  needsAction: boolean;
  /** Stable identity of the condition, so a *changed* problem counts as new. */
  reasonKey: string;
  /** ISO timestamp of the last mail we sent about the current condition. */
  notifiedAt: string;
}

export interface ActionableState<R> {
  needsAction: boolean;
  reason: R | null;
}

export type AlertDecision<R> =
  | { send: false }
  | { send: true; kind: 'problem' | 'recovered'; reason: R | null };

/**
 * Decides whether this check should mail anyone.
 *
 * Edge-triggered: a mail goes out when the condition *changes*, not on every
 * check, so a persistent problem does not turn into an inbox full of identical
 * warnings.
 *
 * The one exception is the re-alert interval. Detection was down for nine days in
 * September without anyone noticing; a single mail that gets missed or filtered
 * reproduces exactly that silence, so a standing problem repeats at most once per
 * interval. Set the interval to 0 to disable repeats entirely.
 *
 * Generic over the reason because the shape of "what is wrong" differs per alert
 * while the question of when to speak up does not.
 */
export function decideAlert<R>(
  previous: AlertState | null,
  current: ActionableState<R>,
  now: number,
  reAlertMs: number,
  reasonKey: (reason: R | null) => string,
): AlertDecision<R> {
  if (current.needsAction) {
    if (!previous?.needsAction) {
      return { send: true, kind: 'problem', reason: current.reason };
    }

    // Same condition still standing. Repeat only once the interval has elapsed,
    // and treat a changed reason as a new occurrence worth reporting.
    if (previous.reasonKey !== reasonKey(current.reason)) {
      return { send: true, kind: 'problem', reason: current.reason };
    }
    if (reAlertMs > 0 && now - Date.parse(previous.notifiedAt) >= reAlertMs) {
      return { send: true, kind: 'problem', reason: current.reason };
    }
    return { send: false };
  }

  // Recovered — but only worth saying if we actually reported the problem.
  if (previous?.needsAction) {
    return { send: true, kind: 'recovered', reason: null };
  }

  return { send: false };
}
