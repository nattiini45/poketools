'use client';

/**
 * Live controls (draft-frontend §7.1): start, pause/resume with an optional
 * reason, end with a required reason, and the clock as players see it
 * (`ClockBar`, read-only). In the Redraft's submission phase there is no
 * pause: moving the deadline pauses it (CRIT B15). "Pick for the active
 * player" opens the draft room, where the admin override lives (§5.10).
 */
import { useId, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import ClockBar from '@/components/draft-tool/layout/ClockBar';
import PlayersSheet from '@/components/draft-tool/layout/PlayersSheet';
import { useClock } from '@/components/draft-tool/hooks/use-clock';
import { NOTIFY_UNSUPPORTED } from '@/components/draft-tool/hooks/use-turn-watch';
import styles from '@/components/draft-tool/draft-tool.module.css';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { FIELD, HINT, InlineError, LABEL, ReasonField } from './admin-ui';
import { reasonValid } from './admin-view';
import { useAdminCall, type AdminResult } from './use-admin-call';

export interface LiveControlsProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  serverOffsetMs: number;
  makeupSeconds: number | null;
  /** The draft room for this pool (admin override there). */
  roomHref: string;
  /** In-page anchor of the deadline editor (submission phase). */
  deadlineHref: string;
  onPause(paused: boolean, reason?: string): AdminResult;
  onStart(): AdminResult;
  onEnd(reason: string): AdminResult;
}

function noop() {}

export default function LiveControls({
  vm,
  catalog,
  serverOffsetMs,
  makeupSeconds,
  roomHref,
  deadlineHref,
  onPause,
  onStart,
  onEnd,
}: LiveControlsProps) {
  const t = useT(draftAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const errorText = useApiErrorText(errorsDraft);
  const clock = useClock(vm.activeSlot, vm.serverNow, serverOffsetMs);
  const pauseCall = useAdminCall();
  const dialogCall = useAdminCall();
  const reasonId = useId();
  const [pauseReason, setPauseReason] = useState('');
  const [dialog, setDialog] = useState<'start' | 'end' | null>(null);
  const [endReason, setEndReason] = useState('');
  const [playersOpen, setPlayersOpen] = useState(false);

  const drafting = vm.phase === 'drafting';
  const canStart = vm.phase === 'setup';
  const canEnd = vm.phase === 'drafting' || vm.phase === 'setup';

  const togglePause = async () => {
    const ok = await pauseCall.run(() => onPause(!vm.paused, pauseReason));
    if (ok) setPauseReason('');
  };

  const closeDialog = () => {
    setDialog(null);
    setEndReason('');
    dialogCall.clearError();
  };

  const confirmDialog = async () => {
    const ok = await dialogCall.run(() => (dialog === 'end' ? onEnd(endReason.trim()) : onStart()));
    if (ok) closeDialog();
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-poke-text-secondary">{t(`live.status.${vm.phase}`)}</p>

      {vm.status !== 'pending' ? (
        <div className={styles.tokens}>
          <ClockBar
            vm={vm}
            clock={clock}
            notify={NOTIFY_UNSUPPORTED}
            onNotifyToggle={noop}
            onExtension={noop}
            onOpenPlayers={() => setPlayersOpen(true)}
            makeupSeconds={makeupSeconds}
          />
          <PlayersSheet vm={vm} catalog={catalog} open={playersOpen} onClose={() => setPlayersOpen(false)} />
        </div>
      ) : null}

      {vm.phase === 'submissions' ? (
        <p className={HINT}>
          {t('live.submissionsPauseHint')}{' '}
          <a href={deadlineHref} className="text-poke-accent hover:underline">
            {t('live.toDeadline')}
          </a>
        </p>
      ) : null}

      {drafting ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1 space-y-1">
            <label htmlFor={reasonId} className={LABEL}>
              {t('live.pauseReason')}
            </label>
            <input
              id={reasonId}
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              maxLength={500}
              className={FIELD}
            />
          </div>
          <Button variant={vm.paused ? 'success' : 'secondary'} onClick={togglePause} disabled={pauseCall.busy}>
            {vm.paused ? t('live.resume') : t('live.pause')}
          </Button>
        </div>
      ) : null}
      {vm.paused ? <p className="text-sm font-semibold uppercase text-poke-text-primary">{tGlossary('draft.paused')}</p> : null}
      <InlineError text={pauseCall.error ? errorText(pauseCall.error) : null} />

      <div className="flex flex-wrap gap-2">
        {canStart ? (
          <Button onClick={() => setDialog('start')}>{t('live.start')}</Button>
        ) : null}
        {drafting && vm.activeSlot ? (
          <Link href={roomHref} className="inline-flex items-center rounded-poke-md border border-poke-border px-3 py-2 text-sm hover:border-poke-accent">
            {t('live.pickFor')}
          </Link>
        ) : null}
        {canEnd ? (
          <Button variant="danger" onClick={() => setDialog('end')}>
            {t('live.end')}
          </Button>
        ) : null}
      </div>
      {drafting && vm.activeSlot ? <p className={HINT}>{t('live.pickForHint')}</p> : null}

      <ArmedConfirmDialog
        open={dialog !== null}
        title={dialog === 'end' ? t('live.endTitle') : t('live.startTitle')}
        body={dialog === 'end' ? t('live.endBody') : t('live.startBody')}
        confirmLabel={dialog === 'end' ? t('live.end') : t('live.start')}
        confirmVariant={dialog === 'end' ? 'danger' : 'primary'}
        confirmDisabled={dialog === 'end' && !reasonValid(endReason)}
        submitting={dialogCall.busy}
        error={dialogCall.error ? errorText(dialogCall.error) : null}
        onConfirm={confirmDialog}
        onCancel={closeDialog}
      >
        {dialog === 'end' ? <ReasonField value={endReason} onChange={setEndReason} /> : null}
      </ArmedConfirmDialog>
    </div>
  );
}
