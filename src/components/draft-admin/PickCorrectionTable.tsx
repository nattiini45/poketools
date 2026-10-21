'use client';

/**
 * All picks of the pool with **Void** (reason, re-queue the slot) and
 * **Correct line** (line + reason) per pick (draft-frontend §7.1). Both are
 * disabled unless the draft is paused or complete (BR-8,
 * `CORRECTION_REQUIRES_PAUSE`), with a Pause shortcut. Server refusals such
 * as `VOID_BLOCKED_PROGRESS` render through `useApiErrorText(errorsDraft)`.
 */
import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import { LocalTime } from '@/i18n/LocalTime';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftViewModel, PickVM } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId } from '@/types/draft-queue';
import { useLineText } from '@/components/draft-tokens/use-line-text';
import { InlineError, ReasonField, TABLE, TD, TH, useDestructiveButton, usePrimaryButton } from './admin-ui';
import { availableLineIds, correctionsAllowed, reasonValid } from './admin-view';
import LineSelect from './LineSelect';
import { useAdminCall, type AdminResult } from './use-admin-call';

export interface PickCorrectionTableProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  /** A void always requeues: the player picks again directly before the current pick. */
  onVoid(pickId: string, reason: string): AdminResult;
  onCorrect(pickId: string, lineId: LineId, reason: string, requestId: string, redraftSlotId?: string): AdminResult;
  /** The Pause shortcut. */
  onPause(): AdminResult;
}

type Dialog = { kind: 'void' | 'correct'; pick: PickVM; requestId: string } | null;

export default function PickCorrectionTable({ vm, catalog, onVoid, onCorrect, onPause }: PickCorrectionTableProps) {
  const t = useT(draftAdminMessages);
  const destructive = useDestructiveButton();
  const primary = usePrimaryButton();
  const errorText = useApiErrorText(errorsDraft);
  const text = useLineText(catalog);
  const call = useAdminCall();
  const pauseCall = useAdminCall();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');
  const [lineId, setLineId] = useState<LineId | ''>('');

  const allowed = correctionsAllowed(vm);
  const freeLines = useMemo(() => availableLineIds(catalog, vm.takenBy), [catalog, vm.takenBy]);
  const picks = [...vm.picks].sort((a, b) => b.pick_number - a.pick_number);

  const open = (kind: 'void' | 'correct', pick: PickVM) => {
    setDialog({ kind, pick, requestId: crypto.randomUUID() });
    setReason('');
    setLineId('');
    call.clearError();
  };
  const close = () => {
    setDialog(null);
    call.clearError();
  };
  const confirm = async () => {
    if (!dialog) return;
    const r = reason.trim();
    const ok = await call.run(() =>
      dialog.kind === 'void'
        ? onVoid(dialog.pick.pick_id, r)
        : onCorrect(dialog.pick.pick_id, lineId as LineId, r, dialog.requestId),
    );
    if (ok) setDialog(null);
  };

  const pickParams = dialog
    ? { pick: dialog.pick.pick_number, name: dialog.pick.playerName, line: text.label(dialog.pick.line_id) }
    : { pick: 0, name: '', line: '' };

  return (
    <div className="space-y-3">
      {!allowed ? (
        <div className="flex flex-wrap items-center gap-2 rounded-poke-md border border-poke-border p-2" role="note">
          <p className="text-sm text-poke-text-secondary">{t('corrections.pauseFirst')}</p>
          {vm.phase === 'drafting' ? (
            <Button size="sm" variant="secondary" disabled={pauseCall.busy} onClick={() => pauseCall.run(onPause)}>
              {t('corrections.pauseNow')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <InlineError text={pauseCall.error ? errorText(pauseCall.error) : null} />

      {picks.length === 0 ? (
        <p className="text-sm text-poke-text-secondary">{t('corrections.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>{t('corrections.col.pick')}</th>
                <th className={TH}>{t('corrections.col.player')}</th>
                <th className={TH}>{t('corrections.col.line')}</th>
                <th className={TH}>{t('corrections.col.price')}</th>
                <th className={TH}>{t('corrections.col.time')}</th>
                <th className={TH}>{t('corrections.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((pick) => (
                <tr key={pick.pick_id} className="border-t border-poke-border">
                  <td className={TD}>{t('corrections.pickNo', { n: pick.pick_number })}</td>
                  <td className={TD}>{pick.playerName}</td>
                  <td className={TD}>
                    {text.label(pick.line_id)}
                    {pick.admin_override ? (
                      <span className="ml-2 rounded-poke-sm border border-poke-border px-1 text-xs text-poke-text-secondary">
                        {t('corrections.adminMark')}
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>{t('corrections.priceValue', { n: pick.price })}</td>
                  <td className={TD}>
                    <LocalTime value={pick.made_at} preset="dateTime" />
                  </td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="secondary" disabled={!allowed} onClick={() => open('void', pick)}>
                        {t('corrections.void')}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={!allowed} onClick={() => open('correct', pick)}>
                        {t('corrections.correct')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ArmedConfirmDialog
        open={dialog !== null}
        title={dialog?.kind === 'correct' ? t('corrections.correctTitle', pickParams) : t('corrections.voidTitle', pickParams)}
        body={dialog?.kind === 'correct' ? t('corrections.correctBody', pickParams) : t('corrections.voidBody', pickParams)}
        confirmLabel={dialog?.kind === 'correct' ? t('corrections.correct') : t('corrections.void')}
        confirmVariant={dialog?.kind === 'void' ? destructive.variant : primary.variant}
        confirmClassName={dialog?.kind === 'void' ? destructive.className : primary.className}
        confirmDisabled={!reasonValid(reason) || (dialog?.kind === 'correct' && !lineId)}
        submitting={call.busy}
        error={call.error ? errorText(call.error) : null}
        onConfirm={confirm}
        onCancel={close}
      >
        <div className="space-y-3">
          {dialog?.kind === 'correct' ? (
            <LineSelect
              catalog={catalog}
              lineIds={freeLines}
              value={lineId}
              onChange={setLineId}
              label={t('corrections.newLine')}
            />
          ) : null}
          <ReasonField value={reason} onChange={setReason} />
          {dialog?.kind === 'void' ? (
            <p className="text-sm text-poke-text-primary">{t('corrections.requeue', pickParams)}</p>
          ) : null}
        </div>
      </ArmedConfirmDialog>
    </div>
  );
}
