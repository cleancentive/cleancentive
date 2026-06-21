import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LOCALE, type Locale } from '@cleancentive/shared';

interface RequestContextStore {
  userId?: string;
  locale: Locale;
}

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getCurrentUserId(): string | undefined {
  return requestContext.getStore()?.userId;
}

/**
 * The locale resolved for the current request (query `?locale=` →
 * `Accept-Language` → default). Falls back to DEFAULT_LOCALE when called
 * outside a request scope (e.g. background jobs).
 */
export function getCurrentLocale(): Locale {
  return requestContext.getStore()?.locale ?? DEFAULT_LOCALE;
}
