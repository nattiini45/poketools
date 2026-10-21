'use client';

import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import type { DraftBoardState } from './draft-board-sync';

type Stall = NonNullable<DraftBoardState['stalled_picker']>;

interface DraftStallNoticeProps {
  stall: Stall;
  /** The stuck player's display name. */
  name: string;
  currentPlayerId: string;
  isAdmin: boolean;
  /** Opens the admin's confirmation to switch the draft to free order. */
  onSwitch: () => void;
}

/**
 * Snake/linear order with fixed prices: the current picker can afford nothing that completes their roster, so the
 * draft cannot go on. Tells the stuck player (in the second person) and everyone else what is going on; admins get
 * the switch to free order (`POST /api/drafts/[id]/free-order`).
 */
export default function DraftStallNotice({ stall, name, currentPlayerId, isAdmin, onSwitch }: DraftStallNoticeProps) {
  const t = useT(draftLegacyBoardMessages);
  const values = { count: stall.open_slots, remaining: stall.remaining, cost: stall.min_cost };
  return (
    <Alert variant="warning">
      <p className="text-sm">
        {stall.player_id === currentPlayerId ? t('board.stall.you', values) : t('board.stall.named', { ...values, name })}
      </p>
      {isAdmin && (
        <div className="mt-2">
          <Button variant="primary" size="sm" onClick={onSwitch}>
            {t('board.stall.switch')}
          </Button>
        </div>
      )}
    </Alert>
  );
}
