'use client';

/**
 * The one place of the player page that handles a failed request and decides about a reload.
 *
 * `run(call)` sends one request at a time (a second call while one is in flight is ignored), keeps the error as the
 * `ApiErrorLike` object the server sent (never translated text: the component renders it with `useApiErrorText`, so a
 * language switch re-renders it), and, when the answer is a `conflict` (the view was stale: a window closed, an item was
 * taken, a challenge was answered), reloads the view through the page's single reload path before it returns.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiErrorLike } from '@/i18n/api-errors';
import type { ApiOutcome } from '@/lib/studio-core/request';
import { classifyFormatRuntimeError, type ActionApiError } from '@/lib/format-engine/runtime/client-api';

export interface RuntimeAction {
  /** Runs one request. `null` = it was not sent (another one is running). Never throws. */
  run: <T, E extends ActionApiError>(call: () => Promise<ApiOutcome<T, E>>) => Promise<ApiOutcome<T, E> | null>;
  pending: boolean;
  /** The last failed answer; cleared when the next request starts. */
  error: ActionApiError | null;
  clearError: () => void;
}

export function useRuntimeAction(reload: () => Promise<void>): RuntimeAction {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ActionApiError | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T, E extends ActionApiError>(call: () => Promise<ApiOutcome<T, E>>): Promise<ApiOutcome<T, E> | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const outcome = await call();
      if (!outcome.ok) {
        if (mounted.current) setError(outcome.error);
        if (classifyFormatRuntimeError(outcome.error, outcome.status).kind === 'conflict') await reloadRef.current();
      }
      return outcome;
    } catch (cause) {
      // The request layer never throws; this keeps a bug in a caller from leaving the buttons disabled.
      const failure = toApiErrorLike(cause);
      if (mounted.current) setError(failure);
      return { ok: false, status: 0, error: failure as E };
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { run, pending, error, clearError };
}
