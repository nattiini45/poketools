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
  /**
   * Statuses that cannot be chosen now, each mapped to the reason (already translated). A blocked status is shown
   * disabled and its reason is printed under the control; the API refuses the change as well. The current status is
   * never blocked. Absent: the control renders exactly as before.
   */
  blocked?: Partial<Record<SeasonStatus, string>>;
}

export default function LeagueStatusControl({ seasonId, currentStatus, blocked }: LeagueStatusControlProps) {
  const router = useRouter();
  const t = useT(leagueAdminMessages);
  const tEnum = useT(enumMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [loading, setLoading] = useState(false);
  const labelId = useId();
  const reasonIdBase = useId();

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

  /** The reason a status is blocked, or null; the current status is never blocked. */
  function reasonFor(status: SeasonStatus): string | null {
    const reason = blocked?.[status];
    return status !== currentStatus && reason ? reason : null;
  }
  const reasonId = (status: SeasonStatus) => `${reasonIdBase}-${status}`;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-xs text-poke-text-muted font-heading">{t('status.label')}</span>
      <div className="flex flex-wrap gap-1">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleChange(option.value)}
            disabled={loading || reasonFor(option.value) !== null}
            aria-pressed={option.value === currentStatus}
            aria-describedby={reasonFor(option.value) !== null ? reasonId(option.value) : undefined}
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
      {STATUS_OPTIONS.map((option) => {
        const reason = reasonFor(option.value);
        return reason === null ? null : (
          <p key={option.value} id={reasonId(option.value)} className="basis-full text-xs text-poke-text-muted">
            {reason}
          </p>
        );
      })}
    </div>
  );
}
