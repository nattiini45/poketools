'use client';

import type { PlayerStreaks } from '@/types/streak';
import { useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';

interface StreakIndicatorProps {
  streaks: PlayerStreaks;
  compact?: boolean;
}

export default function StreakIndicator({ streaks, compact = false }: StreakIndicatorProps) {
  const t = useT(gamificationMessages);
  const items: Array<{ key: string; icon: string; value: string; label: string }> = [];

  if (streaks.current_win_streak >= 3) {
    items.push({
      key: 'win',
      icon: '🔥',
      value: t('streaks.winValue', { n: streaks.current_win_streak }),
      label: t('streaks.win'),
    });
  }
  if (streaks.current_ko_streak > 0) {
    items.push({
      key: 'ko',
      icon: '⚔️',
      value: t('streaks.koValue', { n: streaks.current_ko_streak }),
      label: t('streaks.ko'),
    });
  }
  if (streaks.current_flawless_streak > 0) {
    items.push({
      key: 'flawless',
      icon: '🛡️',
      value: t('streaks.flawlessValue', { n: streaks.current_flawless_streak }),
      label: t('streaks.flawless'),
    });
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <span
          key={item.key}
          title={item.label}
          className={`inline-flex items-center gap-1 rounded-poke-md border border-poke-border bg-poke-elevated text-poke-text-primary font-heading font-semibold ${
            compact ? 'text-xs px-2 py-1' : 'text-sm px-2.5 py-1.5'
          }`}
        >
          <span aria-hidden>{item.icon}</span>
          <span>{item.value}</span>
        </span>
      ))}
    </div>
  );
}
