'use client';

import { useId } from 'react';
import type { SeasonStatus } from '@/types/season';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { seasonMachine } from '@/lib/season/season-state';
import { cn } from '@/lib/utils/cn';
import { useLeagueStatusChange } from './useLeagueStatusChange';

interface LeagueStatusControlProps {
  seasonId: string;
  currentStatus: SeasonStatus;
  /**
   * Statuses that cannot be chosen now, each mapped to the reason (already translated). A blocked status is shown
   * disabled and its reason is printed under the control; the API refuses the change as well. The current status is
   * never blocked. Absent: no status is blocked.
   */
  blocked?: Partial<Record<SeasonStatus, string>>;
}

/**
 * The status of a league as a segmented control in the workspace header: one segment per status of the league
 * machine, the current one pressed. Choosing another writes it at once.
 */
export default function LeagueStatusControl({ seasonId, currentStatus, blocked }: LeagueStatusControlProps) {
  const t = useT(leagueAdminMessages);
  const tEnum = useT(enumMessages);
  const { loading, change } = useLeagueStatusChange(seasonId, currentStatus);
  const labelId = useId();
  const reasonIdBase = useId();

  /** The reason a status is blocked, or null; the current status is never blocked. */
  function reasonFor(status: SeasonStatus): string | null {
    const reason = blocked?.[status];
    return status !== currentStatus && reason ? reason : null;
  }
  const reasonId = (status: SeasonStatus) => `${reasonIdBase}-${status}`;
  /** Whether the league machine lets an admin move to `status` (every status today); the current one stays enabled. */
  const offered = (status: SeasonStatus) => status === currentStatus || seasonMachine.can(currentStatus, status, 'admin');

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="sr-only">
        {t('status.label')}
      </span>
      <div className="inline-flex max-w-full gap-0.5 rounded-poke-md bg-sunken p-0.5" aria-busy={loading || undefined}>
        {seasonMachine.spec.states.map((status) => {
          const current = status === currentStatus;
          return (
            <button
              key={status}
              type="button"
              onClick={() => change(status)}
              disabled={loading || reasonFor(status) !== null || !offered(status)}
              aria-pressed={current}
              aria-describedby={reasonFor(status) !== null ? reasonId(status) : undefined}
              // 44 px touch target on phones.
              className={cn(
                'inline-flex min-h-11 items-center rounded-poke-sm px-3 text-caption focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:cursor-not-allowed motion-safe:transition-colors motion-safe:duration-80 sm:min-h-8',
                current
                  ? 'bg-fg font-[550] text-page'
                  : 'cursor-pointer text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-fg-muted',
              )}
            >
              {enumLabel(tEnum, 'seasonStatus', status)}
            </button>
          );
        })}
      </div>
      {seasonMachine.spec.states.map((status) => {
        const reason = reasonFor(status);
        // `w-0 min-w-full`: the reason wraps inside the control's width instead of widening the header.
        return reason === null ? null : (
          <p key={status} id={reasonId(status)} className="w-0 min-w-full basis-full text-caption text-fg-muted">
            {reason}
          </p>
        );
      })}
    </div>
  );
}
