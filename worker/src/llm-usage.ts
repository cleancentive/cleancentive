import { v7 as uuidv7 } from 'uuid';
import type { Pool } from 'pg';
import { priceUsd } from '@cleancentive/shared';

export type LlmPurpose = 'litter-detection' | 'plant-identification';

/** The shape the OpenAI-compatible providers all return on `completion.usage`. */
export interface CompletionUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export interface LlmUsageRow {
  spotId: string | null;
  purpose: LlmPurpose;
  providerLabel: string;
  providerHost: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Turns a provider's usage block into the row we store, priced at today's rates.
 *
 * Pricing happens here rather than at read time so a later price change never
 * rewrites what a past month cost. An unknown model yields a null cost, which
 * the dashboard reports as unpriced rather than free.
 */
export function buildUsageRow(input: {
  spotId: string | null;
  purpose: LlmPurpose;
  providerLabel: string;
  providerHost: string;
  model: string;
  usage: CompletionUsage | null | undefined;
}): LlmUsageRow {
  const promptTokens = count(input.usage?.prompt_tokens);
  const completionTokens = count(input.usage?.completion_tokens);
  const totalTokens = count(input.usage?.total_tokens) || promptTokens + completionTokens;

  return {
    spotId: input.spotId,
    purpose: input.purpose,
    providerLabel: input.providerLabel,
    providerHost: input.providerHost,
    model: input.model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: priceUsd(input.model, promptTokens, completionTokens),
  };
}

/**
 * Writes one usage row, outside any detection transaction and never throwing.
 *
 * A missing cost row is a reporting gap; a failed pick is something a user sees.
 * Cost telemetry must never be the reason a detection is lost.
 */
export async function recordLlmUsage(pool: Pool, row: LlmUsageRow): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO llm_usage (
         id, spot_id, purpose, provider_label, provider_host, model,
         prompt_tokens, completion_tokens, total_tokens, cost_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        uuidv7(),
        row.spotId,
        row.purpose,
        row.providerLabel,
        row.providerHost,
        row.model,
        row.promptTokens,
        row.completionTokens,
        row.totalTokens,
        row.costUsd,
      ],
    );
  } catch (error) {
    console.error(`Failed to record LLM usage for ${row.model}: ${error instanceof Error ? error.message : error}`);
  }
}
