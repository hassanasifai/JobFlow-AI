// src/lib/errors.ts
// One-line helpers for handling thrown values whose type the language can't
// prove. React Query, fetch chains, and async user-event handlers all throw
// `unknown` — we don't get a guaranteed Error instance.

import { ApiError } from './api';

/**
 * Pull a human-readable message out of any thrown value without the
 * widespread `(e as Error).message` cast that crashes when `e` is not an
 * Error (e.g. a string, a plain object from a JSON response, undefined).
 */
export function getErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  try {
    const json = JSON.stringify(err);
    return json && json !== 'undefined' ? json : 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

/**
 * True when the thrown value carries a usable HTTP status. Useful for
 * branching on 401/403/404 vs generic failure.
 */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
