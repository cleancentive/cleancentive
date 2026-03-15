import { describe, expect, test, vi } from 'vitest';

import { getExistingBrowserWSEndpoint } from './browser-session';

describe('getExistingBrowserWSEndpoint', () => {
  test('returns the websocket endpoint when a shared browser is already running', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc123' }),
    });

    await expect(getExistingBrowserWSEndpoint(9222, fetchJson)).resolves.toBe(
      'ws://127.0.0.1:9222/devtools/browser/abc123',
    );
  });

  test('returns null when no shared browser endpoint is available', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(getExistingBrowserWSEndpoint(9222, fetchJson)).resolves.toBeNull();
  });
});
