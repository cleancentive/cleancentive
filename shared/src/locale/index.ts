/**
 * Canonical locale definitions shared by backend, frontend, and worker.
 *
 * This is the single source of truth for which languages CleanCentive supports.
 * Locale codes are base language subtags (no region): values like `de-CH` or
 * `en-US` are normalized down to `de` / `en`.
 */

export const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Coerce arbitrary input (a profile value, a query param, a single
 * Accept-Language tag) into a supported locale. Lowercases, strips the region
 * subtag, and validates. Returns DEFAULT_LOCALE when the input is missing or
 * unsupported.
 */
export function normalizeLocale(input?: string | null): Locale {
  if (!input) return DEFAULT_LOCALE;
  const base = input.trim().toLowerCase().split('-')[0];
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}

/**
 * Pick the best supported locale from an HTTP `Accept-Language` header value,
 * honouring q-values. Falls back to DEFAULT_LOCALE when nothing matches.
 *
 *   parseAcceptLanguage('fr-CH,fr;q=0.9,en;q=0.8') === 'fr'
 *   parseAcceptLanguage('it,es;q=0.5')            === 'en'  // none supported
 */
export function parseAcceptLanguage(header?: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { base: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.base.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const entry of ranked) {
    if (isSupportedLocale(entry.base)) return entry.base;
  }
  return DEFAULT_LOCALE;
}
