'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SeasonStatus } from '@/types/season';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

/**
 * The status write of a league (PATCH `/api/seasons/[id]`), shared by the status control and the header's
 * Activate action: a refused change shows the route's own message (by code, in the viewer's language), a
 * successful one refreshes the route.
 */
export function useLeagueStatusChange(seasonId: string, currentStatus: SeasonStatus) {
  const router = useRouter();
  const t = useT(leagueAdminMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [loading, setLoading] = useState(false);

  /** The route's own message (by code in the viewer's language), else the generic fallback. */
  function failureText(e: ApiErrorLike): string {
    return e.error || e.code ? errorText(e) : t('status.saveFailed');
  }

  async function change(newStatus: SeasonStatus) {
    if (newStatus === currentStatus) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/seasons/${seasonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        alert(failureText(toApiErrorLike(data)));
        return;
      }

      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return { loading, change };
}
