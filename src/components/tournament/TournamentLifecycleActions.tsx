'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ArchiveButton from '@/components/shared/ArchiveButton';
import DeleteResourceButton from '@/components/shared/DeleteResourceButton';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { TournamentStatus } from '@/types/tournament';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import { patchTournamentStatus } from './lifecycle-requests';
import type { UiError } from './ui-error';

type ReopenErrorKey = 'lifecycle.reopenFailedPhase' | 'lifecycle.reopenFailedTournament';

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
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<UiError<ReopenErrorKey> | null>(null);
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

  // Writes the status column only: matches, results and standings are not touched.
  async function handleReopen() {
    setReopening(true);
    setReopenError(null);
    try {
      const failure = await patchTournamentStatus(tournamentId, 'active');
      setReopenOpen(false);
      if (failure) {
        setReopenError(
          failure.error || failure.code
            ? { api: failure }
            : { key: isPhase ? 'lifecycle.reopenFailedPhase' : 'lifecycle.reopenFailedTournament' },
        );
        return;
      }
      router.refresh();
    } finally {
      setReopening(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'completed' && (
        <Button variant="success" size="sm" onClick={handleComplete} loading={completing}>
          {t('lifecycle.markCompleted')}
        </Button>
      )}
      {status === 'completed' && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setReopenError(null);
            setReopenOpen(true);
          }}
        >
          {t('lifecycle.reopen')}
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
      {status === 'completed' && (
        <ConfirmDialog
          open={reopenOpen}
          onClose={() => setReopenOpen(false)}
          onConfirm={handleReopen}
          title={t(isPhase ? 'lifecycle.reopenTitlePhase' : 'lifecycle.reopenTitleTournament', { name: tournamentName })}
          message={t(isPhase ? 'lifecycle.reopenConsequencePhase' : 'lifecycle.reopenConsequenceTournament')}
          confirmLabel={t('lifecycle.reopenConfirm')}
          confirmVariant="primary"
          loading={reopening}
        />
      )}
      {reopenError && (
        <Alert variant="error" className="w-full">
          {'api' in reopenError ? errorText(reopenError.api) : t(reopenError.key)}
        </Alert>
      )}
    </div>
  );
}