'use client';

import type { Player, PlayerStatus } from '@/types/player';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import { useT } from '@/i18n/client';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { LocalTime } from '@/i18n/LocalTime';

const STATUS_TONE: Record<PlayerStatus, SkewChipTone> = { active: 'win', suspended: 'tier-1', banned: 'loss' };

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
        <SkewChip tone={STATUS_TONE[player.status]}>{t(`players.status.${player.status}`)}</SkewChip>
        {player.status === 'suspended' && player.suspended_until && (
          <span className="text-caption text-fg-muted">
            {t('players.until')} <LocalTime value={player.suspended_until} preset="dateTimeYear" />
          </span>
        )}
      </span>
      {banReasonLine && (
        <span className="line-clamp-2 max-w-xs text-caption text-fg-muted" title={banReasonLine}>
          {banReasonLine}
        </span>
      )}
    </span>
  );
}
