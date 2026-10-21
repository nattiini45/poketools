'use client';

import type { PlayerStreaks } from '@/types/streak';
import { useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';

type StreakKind = 'win' | 'flawless' | 'ko';

interface OverlayStreakBadgeProps {
  streaks: PlayerStreaks | null;
  className?: string;
}

/**
 * Compact streak indicator for broadcast overlays.
 * Shows the most notable active streak (win > KO > flawless).
 */
export default function OverlayStreakBadge({
  streaks,
  className = '',
}: OverlayStreakBadgeProps) {
  const t = useT(broadcastOverlaysMessages);
  if (!streaks) return null;

  const activeStreaks: { kind: StreakKind; value: number; color: string; icon: string }[] = [];

  if (streaks.current_win_streak >= 2) {
    activeStreaks.push({
      kind: 'win',
      value: streaks.current_win_streak,
      color: 'rgb(239,68,68)',
      icon: '\u{1F525}', // fire
    });
  }
  if (streaks.current_flawless_streak >= 1) {
    activeStreaks.push({
      kind: 'flawless',
      value: streaks.current_flawless_streak,
      color: 'rgb(234,179,8)',
      icon: '\u{2B50}', // star
    });
  }
  if (streaks.current_ko_streak >= 3) {
    activeStreaks.push({
      kind: 'ko',
      value: streaks.current_ko_streak,
      color: 'rgb(34,197,94)',
      icon: '\u{1F4A5}', // collision
    });
  }

  if (activeStreaks.length === 0) return null;

  // Show the most notable streak
  const best = activeStreaks[0];

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '12px',
        fontWeight: 700,
        color: best.color,
      }}
    >
      <span>{best.icon}</span>
      <span>{t(`streak.${best.kind}`, { count: best.value })}</span>
    </div>
  );
}
