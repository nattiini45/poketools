'use client';

import type { ReactNode } from 'react';
import SkewPlate from '@/components/ui/SkewPlate';
import { useLeagueStatusChange } from '@/components/league/useLeagueStatusChange';
import type { SeasonStatus } from '@/types/season';
import { cn } from '@/lib/utils/cn';
import { PRIMARY_ACTION_PLATE, PRIMARY_ACTION_TARGET } from './primary-action-classes';

interface LeagueActivateButtonProps {
  seasonId: string;
  currentStatus: SeasonStatus;
  /** The status the league machine's start move leads to. */
  to: SeasonStatus;
  /** Fills its row (the phone action bar). */
  block?: boolean;
  children: ReactNode;
}

/** The header's Activate action: the same status write as the status control (`useLeagueStatusChange`). */
export default function LeagueActivateButton({ seasonId, currentStatus, to, block = false, children }: LeagueActivateButtonProps) {
  const { loading, change } = useLeagueStatusChange(seasonId, currentStatus);
  return (
    <button
      type="button"
      onClick={() => change(to)}
      disabled={loading}
      aria-busy={loading || undefined}
      data-admin-primary-action="activate"
      className={cn(PRIMARY_ACTION_TARGET, 'cursor-pointer disabled:cursor-progress disabled:opacity-60', block && 'flex w-full')}
    >
      <SkewPlate variant="button" tone="primary" className={cn(PRIMARY_ACTION_PLATE, block && 'w-full')}>
        {children}
      </SkewPlate>
    </button>
  );
}
