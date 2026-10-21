'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ArchiveButton from '@/components/shared/ArchiveButton';
import DeleteResourceButton from '@/components/shared/DeleteResourceButton';
import Button from '@/components/ui/Button';
import type { TournamentStatus } from '@/types/tournament';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { leagueAdminHref } from '@/lib/league-admin/tabs';

interface TournamentLifecycleActionsProps {
  tournamentId: string;
  tournamentName: string;
  seasonId: string | null;
  status: TournamentStatus;
  isArchived: boolean;
  canDelete: boolean;
}

export default function TournamentLifecycleActions({
  tournamentId,
  tournamentName,
  seasonId,
  status,
  isArchived,
  canDelete,
}: TournamentLifecycleActionsProps) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const t = useT(tournamentsAdminMessages);
  const errorText = useApiErrorText(errorsTournaments);
  const isPhase = seasonId !== null;

  async function handleComplete() {
    const confirmed = window.confirm(
      isPhase
        ? t('lifecycle.confirmPhase', { name: tournamentName })
        : t('lifecycle.confirmTournament', { name: tournamentName }),
    );
    if (!confirmed) return;

    setCompleting(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      const result: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const failure = toApiErrorLike(result);
        window.alert(
          failure.error || failure.code
            ? errorText(failure)
            : isPhase
              ? t('lifecycle.failedPhase')
              : t('lifecycle.failedTournament'),
        );
        return;
      }

      router.refresh();
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'completed' && (
        <Button variant="success" size="sm" onClick={handleComplete} loading={completing}>
          {t('lifecycle.markCompleted')}
        </Button>
      )}
      <ArchiveButton resourceType="tournament" resourceId={tournamentId} isArchived={isArchived} />
      {canDelete && (
        <DeleteResourceButton
          resourceType="tournament"
          resourceId={tournamentId}
          resourceName={tournamentName}
          redirectTo={seasonId ? leagueAdminHref(seasonId, 'phases') : '/admin/tournaments'}
        />
      )}
    </div>
  );
}