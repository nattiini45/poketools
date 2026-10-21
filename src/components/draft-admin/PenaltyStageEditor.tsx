'use client';

/**
 * Slow-draft penalty stages (draft-frontend §7.1, SPEC:916-922): per
 * participant the current stage (as its pick time) and timeout count; a
 * select bounded by the pool's ladder (`0..ladder.length − 1`) and a
 * required reason.
 */
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { formatDuration } from '@/lib/draft-ui/clock';
import type { DraftViewModel, ParticipantVM } from '@/lib/draft-ui/snapshot-adapter';
import { FIELD, HINT, InlineError, InlineNotice, TABLE, TD, TH, usePrimaryButton } from './admin-ui';
import { penaltyStages, REASON_MAX, reasonValid } from './admin-view';
import { useAdminCall, type AdminResult } from './use-admin-call';

export interface PenaltyStageEditorProps {
  vm: DraftViewModel;
  onSet(playerId: string, stage: number, reason: string): AdminResult;
}

function PenaltyRow({
  participant,
  ladder,
  onSet,
}: {
  participant: ParticipantVM;
  ladder: readonly number[];
  onSet: PenaltyStageEditorProps['onSet'];
}) {
  const t = useT(draftAdminMessages);
  const tScreen = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const errorText = useApiErrorText(errorsDraft);
  const call = useAdminCall();
  const primary = usePrimaryButton();
  const [stage, setStage] = useState(participant.penalty_stage);
  // Re-sync the select when the server stage moves (a timeout, another
  // admin's change, our own save): adjust state during render, no effect.
  const [syncedStage, setSyncedStage] = useState(participant.penalty_stage);
  if (syncedStage !== participant.penalty_stage) {
    setSyncedStage(participant.penalty_stage);
    setStage(participant.penalty_stage);
  }
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);

  const durationOf = (s: number) => formatDuration(ladder[s] ?? 0, tShared);
  const changed = stage !== participant.penalty_stage;

  const save = async () => {
    setSaved(false);
    const ok = await call.run(() => onSet(participant.player_id, stage, reason.trim()));
    if (ok) {
      setReason('');
      setSaved(true);
    }
  };

  return (
    <tr className="border-t border-poke-border">
      <td className={TD}>{participant.name}</td>
      <td className={TD}>
        {t('penalties.stageValue', { stage: participant.penalty_stage + 1, duration: durationOf(participant.penalty_stage) })}
      </td>
      <td className={TD}>{tScreen('players.timeouts', { count: participant.timeout_count })}</td>
      <td className={TD}>
        <div className="flex min-w-[14rem] flex-col gap-1">
          <select
            aria-label={t('penalties.col.change')}
            value={stage}
            onChange={(e) => setStage(Number(e.target.value))}
            className={FIELD}
          >
            {penaltyStages(ladder).map((s) => (
              <option key={s} value={s}>
                {t('penalties.stageOption', { stage: s + 1, duration: durationOf(s) })}
              </option>
            ))}
          </select>
          <input
            aria-label={t('penalties.reason')}
            placeholder={t('penalties.reason')}
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            className={FIELD}
          />
          <Button size="sm" variant={primary.variant} className={primary.className} disabled={!changed || !reasonValid(reason) || call.busy} onClick={save}>
            {t('penalties.save')}
          </Button>
          <InlineError text={call.error ? errorText(call.error) : null} />
          <InlineNotice text={saved ? t('penalties.saved', { name: participant.name }) : null} />
        </div>
      </td>
    </tr>
  );
}

export default function PenaltyStageEditor({ vm, onSet }: PenaltyStageEditorProps) {
  const t = useT(draftAdminMessages);
  const players = [...vm.participants].sort((a, b) => a.seat - b.seat);
  return (
    <div className="space-y-2">
      <p className={HINT}>{t('penalties.hint')}</p>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>{t('penalties.col.player')}</th>
              <th className={TH}>{t('penalties.col.stage')}</th>
              <th className={TH}>{t('penalties.col.timeouts')}</th>
              <th className={TH}>{t('penalties.col.change')}</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <PenaltyRow key={p.player_id} participant={p} ladder={vm.ladderSeconds} onSet={onSet} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
