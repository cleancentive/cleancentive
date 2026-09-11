import { describe, expect, test } from 'bun:test';

import { classifyDetectionHealth, type DetectionSignals } from './system.service';

function signals(overrides: Partial<DetectionSignals> = {}): DetectionSignals {
  return {
    completed: 0,
    failed: 0,
    stuck: 0,
    workerLastAttemptFailed: false,
    windowHours: 24,
    stuckMinutes: 30,
    ...overrides,
  };
}

describe('classifyDetectionHealth', () => {
  test('reports down for the 2026-09 outage signature', () => {
    // Measured on prod: every detection in the window failed and the last success
    // was nine days earlier. The infrastructure health check called this "ok"
    // throughout, because the worker heartbeat and every dependency were fine.
    const result = classifyDetectionHealth(signals({ completed: 0, failed: 3, stuck: 6 }));

    expect(result.status).toBe('down');
    expect(result.reason).toContain('every detection in the last 24h failed (3)');
  });

  test('reports down during a quiet period when the worker last attempt failed', () => {
    // The window alone has a blind spot: between isolated uploads there is no
    // failure inside 24h, yet detection is still broken. The worker's last
    // terminal job carries the signal across those gaps.
    const result = classifyDetectionHealth(signals({ workerLastAttemptFailed: true }));

    expect(result.status).toBe('down');
    expect(result.reason).toContain('none has succeeded since');
  });

  test('reports degraded when some detections still succeed', () => {
    const result = classifyDetectionHealth(signals({ completed: 17, failed: 3 }));

    expect(result.status).toBe('degraded');
    expect(result.reason).toContain('3 of 20');
  });

  test('reports degraded when spots sit unprocessed without any failure', () => {
    const result = classifyDetectionHealth(signals({ completed: 5, stuck: 4 }));

    expect(result.status).toBe('degraded');
    expect(result.reason).toContain('over 30 minutes');
  });

  test('reports ok when detections are completing', () => {
    expect(classifyDetectionHealth(signals({ completed: 42 })).status).toBe('ok');
  });

  test('reports ok when nothing has happened at all', () => {
    // No uploads means no evidence either way — do not page someone for silence.
    expect(classifyDetectionHealth(signals()).status).toBe('ok');
  });
});
