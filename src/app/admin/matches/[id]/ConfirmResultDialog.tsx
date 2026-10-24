'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { uiMessages } from '@/i18n/messages/ui';
import { completionWarnings, type ResultWarning, type SeriesTally } from '@/lib/match/series-tally';

interface PlayerInfo {
  id: string;
  name: string;
}

export type ConfirmResultKind = 'completed' | 'disputed';

interface TallyLineProps {
  tally: SeriesTally;
  player1: PlayerInfo;
  player2: PlayerInfo;
}

/** "Ash 2 – 1 Gary from 3 games", or the none hint; the one place the recorded score is worded. */
export function SeriesTallyLine({ tally, player1, player2 }: TallyLineProps) {
  const t = useT(adminCoreMessages);
  if (tally.recorded === 0) return <>{t('actions.tally.none')}</>;
  return (
    <>
      {t('actions.tally.line', {
        player1: player1.name,
        score1: tally.player1Wins,
        score2: tally.player2Wins,
        player2: player2.name,
        count: tally.recorded,
      })}
    </>
  );
}

interface ConfirmResultBodyProps {
  kind: ConfirmResultKind;
  player1: PlayerInfo;
  player2: PlayerInfo;
  /** Complete: the chosen winner. Dispute: the winner reported so far, or empty. */
  winnerId: string;
  tally: SeriesTally;
  /** The admin note typed on the page, if any. */
  note: string;
  acknowledged: boolean;
  onAcknowledgedChange: (next: boolean) => void;
}

/** The warnings a completion earns; empty for a dispute. */
export function resultWarnings(kind: ConfirmResultKind, tally: SeriesTally, winnerId: string): ResultWarning[] {
  return kind === 'completed' ? completionWarnings(tally, winnerId) : [];
}

/** The dialog's content, split from the Radix portal so it renders in static markup tests. */
export function ConfirmResultBody({
  kind,
  player1,
  player2,
  winnerId,
  tally,
  note,
  acknowledged,
  onAcknowledgedChange,
}: ConfirmResultBodyProps) {
  const t = useT(adminCoreMessages);
  const nameOf = (id: string) => (id === player1.id ? player1.name : player2.name);
  const warnings = resultWarnings(kind, tally, winnerId);
  const trimmedNote = note.trim();

  function warningText(w: ResultWarning): string {
    switch (w.kind) {
      case 'noGames':
        return t('actions.confirm.warnings.noGames');
      case 'undecidedGames':
        return t('actions.confirm.warnings.undecided', { count: w.count });
      case 'belowThreshold':
        return t('actions.confirm.warnings.belowThreshold', { bestOf: w.bestOf, needed: w.winsNeeded });
      case 'contradicts':
        return t('actions.confirm.warnings.contradicts', { leader: nameOf(w.leaderId), chosen: nameOf(w.chosenId) });
    }
  }

  if (kind === 'disputed') {
    return (
      <div className="space-y-2 text-sm text-poke-text-secondary">
        <p className="font-semibold text-poke-text-primary">
          {winnerId
            ? t('actions.confirm.dispute.winner', { winner: nameOf(winnerId) })
            : t('actions.confirm.dispute.noWinner')}
        </p>
        <p>{t('actions.confirm.dispute.effects')}</p>
        {trimmedNote && <p>{t('actions.confirm.note', { note: trimmedNote })}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm text-poke-text-secondary">
      <div className="space-y-1">
        <p className="font-semibold text-poke-text-primary">
          {t('actions.confirm.complete.result', { winner: nameOf(winnerId) })}
        </p>
        <p>
          <SeriesTallyLine tally={tally} player1={player1} player2={player2} />
        </p>
        {tally.bestOf !== null && tally.winsNeeded !== null && (
          <p>{t('actions.tally.bestOf', { bestOf: tally.bestOf, needed: tally.winsNeeded })}</p>
        )}
      </div>
      <p>{t('actions.confirm.complete.effects')}</p>
      {trimmedNote && <p>{t('actions.confirm.note', { note: trimmedNote })}</p>}
      {warnings.length > 0 && (
        <Alert variant="warning" className="space-y-2">
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w) => (
              <li key={w.kind}>{warningText(w)}</li>
            ))}
          </ul>
          <label className="flex items-start gap-2 font-medium text-poke-text-primary">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acknowledged}
              onChange={(e) => onAcknowledgedChange(e.target.checked)}
            />
            <span>{t('actions.confirm.warnings.acknowledge')}</span>
          </label>
        </Alert>
      )}
    </div>
  );
}

interface ConfirmResultDialogProps extends Omit<ConfirmResultBodyProps, 'acknowledged' | 'onAcknowledgedChange'> {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}

/**
 * Asks before an admin completes or disputes a match: the result, the
 * recorded series tally and what the action triggers. A completion that the
 * recorded games contradict (or that has none) needs a ticked
 * acknowledgement. The acknowledgement lives in the content, which Radix
 * unmounts on close, so it starts unticked on every open.
 */
export default function ConfirmResultDialog({ open, onClose, onConfirm, loading, ...body }: ConfirmResultDialogProps) {
  const t = useT(adminCoreMessages);
  const title = body.kind === 'completed' ? t('actions.confirm.complete.title') : t('actions.confirm.dispute.title');
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <ConfirmResultContent {...body} onClose={onClose} onConfirm={onConfirm} loading={loading} />
    </Modal>
  );
}

function ConfirmResultContent({
  onClose,
  onConfirm,
  loading,
  ...body
}: Omit<ConfirmResultDialogProps, 'open'>) {
  const t = useT(adminCoreMessages);
  const tUi = useT(uiMessages);
  const [acknowledged, setAcknowledged] = useState(false);
  const needsAcknowledge = resultWarnings(body.kind, body.tally, body.winnerId).length > 0;
  const complete = body.kind === 'completed';

  return (
    <>
      <div className="mb-6">
        <ConfirmResultBody {...body} acknowledged={acknowledged} onAcknowledgedChange={setAcknowledged} />
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
          {tUi('confirmDialog.cancel')}
        </Button>
        <Button
          variant={complete ? 'success' : 'danger'}
          size="sm"
          onClick={onConfirm}
          loading={loading}
          disabled={complete && needsAcknowledge && !acknowledged}
        >
          {complete ? t('actions.confirm.complete.confirm') : t('actions.confirm.dispute.confirm')}
        </Button>
      </div>
    </>
  );
}
