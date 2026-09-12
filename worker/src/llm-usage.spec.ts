import { describe, test, expect } from 'bun:test';
import { buildUsageRow } from './llm-usage';
import { providerHost } from './detection-providers';

const base = {
  spotId: 'a2f0f1de-0000-7000-8000-000000000000',
  purpose: 'litter-detection' as const,
  providerLabel: 'primary',
  providerHost: 'api.mistral.ai',
  model: 'mistral-medium-latest',
};

describe('buildUsageRow', () => {
  test('prices a normal detection call', () => {
    const row = buildUsageRow({
      ...base,
      usage: { prompt_tokens: 1800, completion_tokens: 250, total_tokens: 2050 },
    });

    expect(row.promptTokens).toBe(1800);
    expect(row.completionTokens).toBe(250);
    expect(row.totalTokens).toBe(2050);
    expect(row.costUsd).toBeCloseTo(0.004575, 10);
  });

  test('derives the total when the provider omits it', () => {
    const row = buildUsageRow({ ...base, usage: { prompt_tokens: 100, completion_tokens: 20 } });
    expect(row.totalTokens).toBe(120);
  });

  test('a missing usage block yields zeros rather than throwing', () => {
    const row = buildUsageRow({ ...base, usage: undefined });
    expect(row.promptTokens).toBe(0);
    expect(row.totalTokens).toBe(0);
    expect(row.costUsd).toBe(0);
  });

  test('an unpriced model records tokens but no cost', () => {
    const row = buildUsageRow({
      ...base,
      model: 'some-eu-hoster/llama-4',
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
    });

    expect(row.promptTokens).toBe(1000);
    expect(row.costUsd).toBeNull();
  });

  test('nonsense token counts are floored at zero, never negative cost', () => {
    const row = buildUsageRow({
      ...base,
      usage: { prompt_tokens: -5, completion_tokens: null, total_tokens: NaN },
    });

    expect(row.promptTokens).toBe(0);
    expect(row.completionTokens).toBe(0);
    expect(row.totalTokens).toBe(0);
    expect(row.costUsd).toBe(0);
  });

  test('carries the provider identity so a fallback is attributable', () => {
    const row = buildUsageRow({
      ...base,
      providerLabel: 'fallback-1',
      providerHost: 'api.openai.com',
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 10, completion_tokens: 1 },
    });

    expect(row.providerLabel).toBe('fallback-1');
    expect(row.providerHost).toBe('api.openai.com');
  });
});

describe('providerHost', () => {
  test('extracts the host from a base URL', () => {
    expect(providerHost('https://api.mistral.ai/v1')).toBe('api.mistral.ai');
  });

  test('an unset base URL means the SDK default, which is OpenAI', () => {
    expect(providerHost(undefined)).toBe('api.openai.com');
  });

  test('an unparseable base URL is kept verbatim rather than lost', () => {
    expect(providerHost('not a url')).toBe('not a url');
  });
});
