/**
 * Published list prices for the models we call, in USD.
 *
 * Mistral has no billing API on our plan — `GET /v1/admin/usage` is Enterprise
 * only — so the only way to know what detection costs is to meter the token
 * counts every response already carries and price them ourselves.
 *
 * Source: https://mistral.ai/pricing/api, read 2026-09-12. A model that is not
 * listed here prices as `null` rather than 0, so an unpriced call shows up as a
 * gap on the cost dashboard instead of quietly looking free.
 */

export interface TokenPrice {
  /** USD per million input tokens. */
  inputPerMTokens: number;
  /** USD per million output tokens. */
  outputPerMTokens: number;
}

export interface PagePrice {
  /** USD per thousand pages. */
  perThousandPages: number;
}

export const TOKEN_PRICES: Record<string, TokenPrice> = {
  'mistral-medium-latest': { inputPerMTokens: 1.5, outputPerMTokens: 7.5 },
  'mistral-small-latest': { inputPerMTokens: 0.15, outputPerMTokens: 0.6 },
  'mistral-large-latest': { inputPerMTokens: 0.5, outputPerMTokens: 1.5 },
  'codestral-latest': { inputPerMTokens: 0.3, outputPerMTokens: 0.9 },
};

export const PAGE_PRICES: Record<string, PagePrice> = {
  // Document AI rate, not the plain OCR rate: every invoice request sends a
  // document_annotation_format, and any annotation format moves the request to
  // the annotated-page tier.
  'mistral-ocr-latest': { perThousandPages: 5 },
};

/**
 * Resolves a dated model release to its `-latest` alias.
 *
 * We store the model name we configured, but a provider is free to answer with
 * the resolved release (`mistral-medium-2508`). Both must price the same or the
 * dashboard develops holes the day Mistral cuts a new release.
 */
function normalize(model: string): string {
  return model.replace(/-\d{4,8}$/, '-latest');
}

function lookup<T>(table: Record<string, T>, model: string): T | null {
  return table[model] ?? table[normalize(model)] ?? null;
}

/** USD for one token-priced call, or null when the model has no published price. */
export function priceUsd(model: string, promptTokens: number, completionTokens: number): number | null {
  const price = lookup(TOKEN_PRICES, model);
  if (!price) return null;

  return (
    (promptTokens / 1_000_000) * price.inputPerMTokens +
    (completionTokens / 1_000_000) * price.outputPerMTokens
  );
}

/** USD for one page-priced call, or null when the model has no published price. */
export function pagePriceUsd(model: string, pages: number): number | null {
  const price = lookup(PAGE_PRICES, model);
  if (!price) return null;

  return (pages / 1_000) * price.perThousandPages;
}
