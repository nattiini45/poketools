'use client';

/**
 * Live controls (draft-frontend §7.1): start, pause/resume with an optional
 * reason, end with a required reason, and the clock as players see it
 * (`ClockBar`, read-only). In the Redraft's submission phase there is no
 * pause: moving the deadline pauses it (CRIT B15). "Pick for the active
 * player" opens the draft room on the control page; inside the room's admin
 * sheet it switches the room's admin override on (§5.10), so the pick itself
 * always goes through the room's DRAFT button and confirm dialog.
 *
 * `showClock` is off in the room's admin sheet: the room's own clock bar and
 * its banners (paused, blocked) stay visible there.
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
import { FIELD, HINT, InlineError, LABEL, ReasonField, useDestructiveButton, usePrimaryButton } from './admin-ui';
import { reasonValid } from './admin-view';
import { useAdminCall, type AdminResult } from './use-admin-call';

/** "Pick for the active player": a link to the room (control page) or the room's own override switch (admin sheet). */
export type PickForTarget = { kind: 'link'; href: string } | { kind: 'override'; onEnable(): void };

/** "Edit the deadline": an in-page anchor (control page) or a callback that opens the Redraft tab (admin sheet). */
export type DeadlineTarget = { kind: 'anchor'; href: string } | { kind: 'action'; onOpen(): void };

export interface LiveControlsProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  serverOffsetMs: number;
  makeupSeconds: number | null;
  pickFor: PickForTarget;
  deadline: DeadlineTarget;
  /** The read-only clock bar (default true; the room's admin sheet hides it, the room shows its own). */
  showClock?: boolean;
  onPause(paused: boolean, reason?: string): AdminResult;
  onStart(): AdminResult;
  onEnd(reason: string): AdminResult;
}

function noop() {}

/**
 * The clock as players see it (control page only). Its own component so the
 * per-second clock tick re-renders only this bar, and the room's admin sheet
 * (no clock) does not tick at all.
 */
function ReadOnlyClock({
  vm,
  catalog,
  serverOffsetMs,
  makeupSeconds,
}: Pick<LiveControlsProps, 'vm' | 'catalog' | 'serverOffsetMs' | 'makeupSeconds'>) {
  const clock = useClock(vm.activeSlot, vm.serverNow, serverOffsetMs);
  const [playersOpen, setPlayersOpen] = useState(false);
  return (
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
  );
}

export default function LiveControls({
  vm,
  catalog,
  serverOffsetMs,
  makeupSeconds,
  pickFor,
  deadline,
  showClock = true,
  onPause,
  onStart,
  onEnd,
}: LiveControlsProps) {
  const t = useT(draftAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const errorText = useApiErrorText(errorsDraft);
  const destructive = useDestructiveButton();
  const primary = usePrimaryButton();
  const pauseCall = useAdminCall();
  const dialogCall = useAdminCall();
  const reasonId = useId();
  const [pauseReason, setPauseReason] = useState('');
  const [dialog, setDialog] = useState<'start' | 'end' | null>(null);
  const [endReason, setEndReason] = useState('');

  const drafting = vm.phase === 'drafting';
  // The room's override switch exists only while someone else is on the clock (DraftToolScreen `showAdminToggle`).
  const canPickFor =
    pickFor.kind === 'link'
      ? drafting && vm.activeSlot !== null
      : vm.status === 'in_progress' && vm.activeSlot !== null && !vm.activeSlot.isViewer;
  const canStart = vm.phase === 'setup';
  // Abort needs started picks to void: before the start the end route can only refuse, so setup shows a hint instead.
  const canEnd = vm.phase === 'drafting';

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
      <p className="text-sm text-poke-text-secondary">{t(vm.phase === 'drafting' && vm.paused ? 'live.status.draftingPaused' : `live.status.${vm.phase}`)}</p>

      {showClock && vm.status !== 'pending' ? (
        <ReadOnlyClock vm={vm} catalog={catalog} serverOffsetMs={serverOffsetMs} makeupSeconds={makeupSeconds} />
      ) : null}

      {vm.phase === 'submissions' ? (
        <p className={HINT}>
          {t('live.submissionsPauseHint')}{' '}
          {deadline.kind === 'anchor' ? (
            <a href={deadline.href} className="text-poke-accent hover:underline">
              {t('live.toDeadline')}
            </a>
          ) : (
            <button
              type="button"
              onClick={deadline.onOpen}
              className="text-poke-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('live.toDeadline')}
            </button>
          )}
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
          <Button variant={primary.variant} className={primary.className} onClick={() => setDialog('start')}>{t('live.start')}</Button>
        ) : null}
        {canPickFor && pickFor.kind === 'link' ? (
          <Link href={pickFor.href} className="inline-flex min-h-[44px] items-center rounded-poke-md border border-poke-border px-3 py-2 text-sm hover:border-poke-accent md:min-h-0">
            {t('live.pickFor')}
          </Link>
        ) : null}
        {canPickFor && pickFor.kind === 'override' ? (
          <Button variant="secondary" onClick={pickFor.onEnable}>
            {t('live.pickFor')}
          </Button>
        ) : null}
        {canEnd ? (
          <Button variant={destructive.variant} className={destructive.className} onClick={() => setDialog('end')}>
            {t('live.end')}
          </Button>
        ) : null}
      </div>
      {vm.phase === 'setup' ? <p className={HINT}>{t('live.endSetupHint')}</p> : null}
      {canPickFor ? (
        <p className={HINT}>{pickFor.kind === 'link' ? t('live.pickForHint') : t('live.pickForRoomHint')}</p>
      ) : null}

      <ArmedConfirmDialog
        open={dialog !== null}
        title={dialog === 'end' ? t('live.endTitle') : t('live.startTitle')}
        body={dialog === 'end' ? t('live.endBody') : t('live.startBody')}
        confirmLabel={dialog === 'end' ? t('live.end') : t('live.start')}
        confirmVariant={dialog === 'end' ? destructive.variant : primary.variant}
        confirmClassName={dialog === 'end' ? destructive.className : primary.className}
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
