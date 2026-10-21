'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import type { SeasonStatus } from '@/types/season';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

const STATUS_OPTIONS: { value: SeasonStatus; variant: 'gray' | 'green' | 'blue' }[] = [
  { value: 'upcoming', variant: 'gray' },
  { value: 'active', variant: 'green' },
  { value: 'completed', variant: 'blue' },
];

interface LeagueStatusControlProps {
  seasonId: string;
  currentStatus: SeasonStatus;
}

export default function LeagueStatusControl({ seasonId, currentStatus }: LeagueStatusControlProps) {
  const router = useRouter();
  const t = useT(leagueAdminMessages);
  const tEnum = useT(enumMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [loading, setLoading] = useState(false);
  const labelId = useId();

  /** The route's own message (by code in the viewer's language), else the generic fallback. */
  function failureText(e: ApiErrorLike): string {
    return e.error || e.code ? errorText(e) : t('status.saveFailed');
  }

  async function handleChange(newStatus: SeasonStatus) {
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

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-xs text-poke-text-muted font-heading">{t('status.label')}</span>
      <div className="flex flex-wrap gap-1">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleChange(option.value)}
            disabled={loading}
            aria-pressed={option.value === currentStatus}
            // 44 px touch target on phones; the badge keeps its compact look inside it.
            className="inline-flex min-h-11 items-center rounded-poke-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:opacity-50 motion-safe:transition-opacity sm:min-h-0"
          >
            <Badge
              variant={option.variant}
              className={
                option.value === currentStatus
                  ? 'ring-2 ring-offset-1 ring-poke-border'
                  : 'opacity-40 hover:opacity-70 cursor-pointer'
              }
            >
              {enumLabel(tEnum, 'seasonStatus', option.value)}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
