'use client';

/**
 * Busy/error state for one admin control. Panel callbacks resolve to
 * `ApiErrorLike | null` (null = success, the panel has refreshed); the
 * control keeps the error object (never translated text) and renders it with
 * `useApiErrorText(errorsDraft)`.
 */
import { useCallback, useState } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';

export type AdminResult = Promise<ApiErrorLike | null>;

export interface AdminCallState {
  busy: boolean;
  error: ApiErrorLike | null;
  /** Runs `fn` unless busy; resolves to true on success. */
  run(fn: () => AdminResult): Promise<boolean>;
  clearError(): void;
}

export function useAdminCall(): AdminCallState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const run = useCallback(async (fn: () => AdminResult): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const err = await fn();
      setError(err);
      return err === null;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { busy, error, run, clearError };
}
