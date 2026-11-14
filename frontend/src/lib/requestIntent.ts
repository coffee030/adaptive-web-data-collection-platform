import { ApiError } from './api';

export interface RequestIntent<T extends object> {
  body: T & { request_key: string };
  storageKey?: string;
}

export async function prepareRequestIntent<T extends object>(resource: string, input: T): Promise<RequestIntent<T>> {
  let requestKey: string = crypto.randomUUID();
  let storageKey: string | undefined;
  try {
    // Keep identifiers and a fingerprint in session storage, never the input.
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    storageKey = resource + ':' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const stored = sessionStorage.getItem(storageKey);
    if (stored) requestKey = stored;
    else sessionStorage.setItem(storageKey, requestKey);
  } catch {
    storageKey = undefined;
  }
  return { body: { ...input, request_key: requestKey }, storageKey };
}

export function forgetRequestIntent(intent: RequestIntent<object>) {
  if (!intent.storageKey) return;
  try {
    sessionStorage.removeItem(intent.storageKey);
  } catch {
    // The retained key is tied to the same request fingerprint.
  }
}

export function isUncertainWrite(error: unknown) {
  return !(error instanceof ApiError) || error.kind !== 'http' || !error.status
    || error.status >= 500 || error.status === 408;
}
