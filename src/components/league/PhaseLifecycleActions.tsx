'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertDialog, AlertDialogBackdrop, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from '@ui-sdk/react/alert-dialog';
import { deleteRebuildWarning } from '@/components/shared/DeleteResourceButton';
import Alert from '@/components/ui/Alert';
import Button, { getButtonClasses } from '@/components/ui/Button';
import { type ApiErrorLike } from '@/i18n/api-errors';
import { useT } from '@/i18n/client';
import { errorsAdmin, errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';
import { uiMessages } from '@/i18n/messages/ui';
import { useApiErrorText } from '@/i18n/use-api-error';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import { phaseMachine } from '@/lib/league-phase/phase-state';
import type { ApiResult, ApiWarning } from '@/types/api';
import type { LeaguePhase } from '@/types/season';

const changes = {
  complete: { status: 'completed' },
  reopen: { status: 'active' },
  archive: { archived: true },
  restore: { archived: false },
  delete: { confirm: true },
} as const;

interface PhaseLifecycleActionsProps {
  phase: Pick<LeaguePhase, 'id' | 'season_id' | 'name' | 'status' | 'archived'>;
  canDelete: boolean;
  formatManaged: boolean;
}

export default function PhaseLifecycleActions({ phase, canDelete, formatManaged }: PhaseLifecycleActionsProps) {
  const t = useT(leaguePhasesMessages);
  const tUi = useT(uiMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments, errorsAdmin);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<ApiErrorLike | true | null>(null);
  const [warnings, setWarnings] = useState<ApiWarning[]>([]);
  const [deletedWarning, setDeletedWarning] = useState<ApiErrorLike | null>(null);
  const back = leagueAdminHref(phase.season_id, 'phases');
  const busy = refreshing || writing;
  const actions: (keyof typeof changes)[] = [];
  if (!phase.archived && !formatManaged) {
    for (const { event } of phaseMachine.transitionsFrom(phase.status, 'admin')) {
      if (event === 'complete' || event === 'reopen') actions.push(event);
    }
  }
  actions.push(phase.archived ? 'restore' : 'archive');
  if (canDelete && !formatManaged) actions.push('delete');

  async function save(action: keyof typeof changes) {
    if (busy) return;
    setWriting(true);
    setError(null);
    setWarnings([]);
    try {
      const response = await fetch(`/api/seasons/${encodeURIComponent(phase.season_id)}/phases/${encodeURIComponent(phase.id)}`, {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes[action]),
      });
      const result: ApiResult<unknown> = await response.json();
      if (!result.success) setError(result);
      else if (!response.ok) setError(true);
      else if (action === 'delete') {
        const warning = deleteRebuildWarning(result);
        if (warning) setDeletedWarning(warning);
        else router.push(back);
      } else {
        setWarnings(result.warnings ?? []);
        startRefresh(() => router.refresh());
      }
    } catch {
      setError(true);
    } finally {
      setWriting(false);
    }
  }

  if (deletedWarning) {
    return (
      <Alert variant="warning">
        {errorText(deletedWarning)}{' '}
        <Link href={back} className="font-medium underline">{t('lifecycle.back')}</Link>
      </Alert>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map(action => {
        const label = t(`lifecycle.${action}.label`);
        const title = t(`lifecycle.${action}.title`, { name: phase.name });
        const message = t(`lifecycle.${action}.message`);
        return (
          <AlertDialog key={action}>
            <AlertDialogTrigger disabled={busy} className={getButtonClasses(action === 'complete' ? 'primary' : 'secondary', 'sm')}>
              {label}
            </AlertDialogTrigger>
            <AlertDialogBackdrop className="fixed inset-0 z-50 backdrop-blur-xs" />
            <AlertDialogContent className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-poke-xl border border-poke-border bg-poke-surface p-6 shadow-poke-lg">
              <AlertDialogTitle className="text-lg font-heading font-bold text-poke-text-primary">{title}</AlertDialogTitle>
              <AlertDialogDescription className="my-4 text-sm text-poke-text-secondary">{message}</AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-3">
                <AlertDialogClose render={<Button type="button" variant="ghost" size="sm" />}>{tUi('confirmDialog.cancel')}</AlertDialogClose>
                <AlertDialogClose action={() => save(action)} data-agent-confirm={message}
                  render={<Button type="button" variant={action === 'delete' ? 'danger' : 'primary'} size="sm" />}>
                  {label}
                </AlertDialogClose>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        );
      })}
      {error && <Alert variant="error" className="w-full">{error === true ? t('lifecycle.failed') : errorText(error)}</Alert>}
      {warnings.map(warning => <Alert variant="warning" className="w-full" key={warning.code}>{errorText(warning)}</Alert>)}
    </div>
  );
}
