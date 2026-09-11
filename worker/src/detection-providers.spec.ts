import { describe, test, expect } from 'bun:test';
import {
  buildDetectionProviders,
  describeProviderError,
  isEntitlementWall,
  shouldTryNextProvider,
} from './detection-providers';

function apiError(status: number, headers?: Record<string, string>): unknown {
  return Object.assign(new Error(`${status} status code (no body)`), { status, headers });
}

describe('isEntitlementWall', () => {
  test('detects the prod signature: 429 with a rate limit ceiling of zero', () => {
    // Regression: Mistral returned exactly this for nine days while the API key
    // stayed valid. Retrying or backing off can never clear it — only billing can.
    expect(isEntitlementWall(apiError(429, {
      'x-ratelimit-limit-req-minute': '0',
      'x-ratelimit-remaining-req-minute': '0',
    }))).toBe(true);
  });

  test('treats a 429 with a real ceiling as an ordinary rate limit', () => {
    expect(isEntitlementWall(apiError(429, {
      'x-ratelimit-limit-req-minute': '60',
      'x-ratelimit-remaining-req-minute': '0',
    }))).toBe(false);
  });

  test('ignores non-429 failures and 429s with no headers', () => {
    expect(isEntitlementWall(apiError(500, { 'x-ratelimit-limit-req-minute': '0' }))).toBe(false);
    expect(isEntitlementWall(apiError(429))).toBe(false);
  });

  test('reads a Headers instance as well as a plain record', () => {
    const error = Object.assign(new Error('rate limited'), {
      status: 429,
      headers: new Headers({ 'x-ratelimit-limit-requests': '0' }),
    });
    expect(isEntitlementWall(error)).toBe(true);
  });
});

describe('shouldTryNextProvider', () => {
  test('fails over on provider-side failures', () => {
    for (const status of [401, 403, 429, 500, 502, 503]) {
      expect(shouldTryNextProvider(apiError(status))).toBe(true);
    }
  });

  test('does not fail over on our own bad request', () => {
    // Every provider would reject a malformed request identically, so walking the
    // rest of the chain only burns calls.
    for (const status of [400, 404, 422]) {
      expect(shouldTryNextProvider(apiError(status))).toBe(false);
    }
  });
});

describe('buildDetectionProviders', () => {
  test('builds the primary from DETECTION_*', () => {
    const providers = buildDetectionProviders({
      DETECTION_API_KEY: 'k',
      DETECTION_BASE_URL: 'https://api.mistral.ai/v1',
      DETECTION_MODEL: 'mistral-medium-latest',
    } as NodeJS.ProcessEnv);

    expect(providers).toHaveLength(1);
    expect(providers[0].label).toBe('primary');
    expect(providers[0].model).toBe('mistral-medium-latest');
  });

  test('appends fallbacks in order and stops at the first gap', () => {
    const providers = buildDetectionProviders({
      DETECTION_API_KEY: 'k',
      DETECTION_MODEL: 'mistral-medium-latest',
      DETECTION_FALLBACK_1_API_KEY: 'k1',
      DETECTION_FALLBACK_1_MODEL: 'gpt-5-mini',
      DETECTION_FALLBACK_3_API_KEY: 'k3',
      DETECTION_FALLBACK_3_MODEL: 'never-reached',
    } as NodeJS.ProcessEnv);

    expect(providers.map((p) => p.model)).toEqual(['mistral-medium-latest', 'gpt-5-mini']);
  });

  test('requires an explicit model instead of defaulting to one', () => {
    // Regression: the old `|| 'gpt-4o-mini'` default pointed a Mistral base URL at
    // an OpenAI model name and wrote that false name into detected_items.source_model.
    expect(() => buildDetectionProviders({ DETECTION_API_KEY: 'k' } as NodeJS.ProcessEnv)).toThrow(/DETECTION_MODEL is required/);
  });

  test('returns an empty chain when nothing is configured', () => {
    expect(buildDetectionProviders({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe('describeProviderError', () => {
  test('flags an entitlement wall as needing billing rather than a retry', () => {
    const provider = buildDetectionProviders({
      DETECTION_API_KEY: 'k',
      DETECTION_MODEL: 'mistral-medium-latest',
    } as NodeJS.ProcessEnv)[0];

    const described = describeProviderError(provider, apiError(429, { 'x-ratelimit-limit-req-minute': '0' }));
    expect(described).toContain('primary (mistral-medium-latest)');
    expect(described).toContain('needs billing, not a retry');
  });
});
