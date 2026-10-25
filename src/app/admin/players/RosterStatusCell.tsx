'use client';

import type { Player, PlayerStatus } from '@/types/player';
import Badge from '@/components/ui/Badge';
import { useT } from '@/i18n/client';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { LocalTime } from '@/i18n/LocalTime';

function statusVariant(status: PlayerStatus): 'green' | 'yellow' | 'red' {
  switch (status) {
    case 'active': return 'green';
    case 'suspended': return 'yellow';
    case 'banned': return 'red';
  }
}

/** The roster's Status column: the badge, when a suspension ends, and why a player is banned. */
export function RosterStatusCell({
  player,
}: {
  player: Pick<Player, 'status' | 'suspended_until' | 'ban_reason'>;
}) {
  const t = useT(adminCoreMessages);
  const banReason = player.status === 'banned' ? player.ban_reason?.trim() : '';
  const banReasonLine = banReason ? t('players.banReason', { reason: banReason }) : '';
  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(player.status)}>{t(`players.status.${player.status}`)}</Badge>
        {player.status === 'suspended' && player.suspended_until && (
          <span className="text-xs text-poke-text-muted">
            {t('players.until')} <LocalTime value={player.suspended_until} preset="dateTimeYear" />
          </span>
        )}
      </span>
      {banReasonLine && (
        <span className="line-clamp-2 max-w-xs text-xs text-poke-text-muted" title={banReasonLine}>
          {banReasonLine}
        </span>
      )}
    </span>
  );
}
