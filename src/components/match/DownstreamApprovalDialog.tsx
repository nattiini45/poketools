'use client';

import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { enumMessages } from '@/i18n/messages/enums';
import { uiMessages } from '@/i18n/messages/ui';
import type { DownstreamApproval } from '@/lib/match/game-change-outcome';

interface DownstreamApprovalDialogProps {
  /** The approval the API asked for (409 `game_change_downstream_played`); the dialog is open while it is set. */
  approval: DownstreamApproval | null;
  /** The admin approves: send the same request again with the confirm flag. */
  onApprove: () => void;
  onCancel: () => void;
  loading?: boolean;
}

/**
 * The approval prompt of an admin game edit or delete that affects the part of the bracket that was already played:
 * the winner of the match played later bracket matches, and the change resets them. Lists those matches and sends
 * nothing itself; the form that opened it resends its request on approval.
 */
export default function DownstreamApprovalDialog({
  approval,
  onApprove,
  onCancel,
  loading = false,
}: DownstreamApprovalDialogProps) {
  const t = useT(adminCoreMessages);
  const tUi = useT(uiMessages);
  const tEnums = useT(enumMessages);

  return (
    <Modal
      open={approval !== null}
      onClose={() => {
        if (!loading) onCancel();
      }}
      title={t('gameChange.downstream.title')}
      size="md"
    >
      {approval && (
        <div className="space-y-3 text-sm text-fg-muted">
          <p>{t('gameChange.downstream.intro', { count: approval.count })}</p>
          {approval.matches.length > 0 && (
            <div>
              <p className="font-semibold text-fg">{t('gameChange.downstream.listHeading')}</p>
              <ul className="mt-1 list-disc pl-5">
                {approval.matches.map((match) => (
                  <li key={match.id}>
                    {t('gameChange.downstream.item', {
                      player1: match.player_1_name,
                      player2: match.player_2_name,
                      round: match.round_name,
                      status: enumLabel(tEnums, 'matchStatus', match.status),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
              {tUi('confirmDialog.cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={onApprove} loading={loading}>
              {t('gameChange.downstream.approve')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
