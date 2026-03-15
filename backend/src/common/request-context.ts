import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContextStore {
  userId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getCurrentUserId(): string | undefined {
  return requestContext.getStore()?.userId;
}
