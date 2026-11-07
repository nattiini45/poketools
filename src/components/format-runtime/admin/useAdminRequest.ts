'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { useApiErrorText } from '@/i18n/use-api-error';
import { classifyFormatRuntimeError } from '@/lib/format-engine/runtime/client-api';
import type { ApiOutcome } from '@/lib/studio-core/request';

/**
 * The one place an admin island of the live tab sends a request and handles its failure.
 *
 * - `run(call)` sets `pending`, stores the `ApiErrorLike` of a failure (never translated text, so a language switch
 *   re-renders correctly) and returns the outcome to the caller.
 * - A `conflict` failure (the page was stale: a check already resolved, an action already locked, ...) refreshes the
 *   server page, which is the only source of the panel's data, so the island shows the current state next.
 * - `refresh()` re-reads the server page after a successful write.
 */
export function useAdminRequest() {
  const router = useRouter();
  const errorText = useApiErrorText(errorsSeasons, errorsAdmin, errorsCommon);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);

  const run = useCallback(
    async <T>(call: () => Promise<ApiOutcome<T>>): Promise<ApiOutcome<T>> => {
      setPending(true);
      setError(null);
      const outcome = await call();
      setPending(false);
      if (!outcome.ok) {
        setError(outcome.error);
        if (classifyFormatRuntimeError(outcome.error, outcome.status).kind === 'conflict') router.refresh();
      }
      return outcome;
    },
    [router],
  );

  const clearError = useCallback(() => setError(null), []);

  return { pending, error, errorMessage: error === null ? null : errorText(error), run, refresh, clearError };
}
