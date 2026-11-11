'use client';

import { Flame, Shield, Swords, type LucideIcon } from 'lucide-react';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import type { PlayerStreaks } from '@/types/streak';
import { useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';

interface StreakChipsProps {
  streaks: PlayerStreaks;
}

/**
 * A player's running streaks as skewed chips with Lucide icons: the site twin of `StreakIndicator`, which keeps
 * its emoji pills because the frozen match highlight card renders it.
 */
export default function StreakChips({ streaks }: StreakChipsProps) {
  const t = useT(gamificationMessages);
  const items: Array<{ key: string; Icon: LucideIcon; tone: SkewChipTone; value: string; label: string }> = [];

  if (streaks.current_win_streak >= 3) {
    items.push({ key: 'win', Icon: Flame, tone: 'tier-2', value: t('streaks.winValue', { n: streaks.current_win_streak }), label: t('streaks.win') });
  }
  if (streaks.current_ko_streak > 0) {
    items.push({ key: 'ko', Icon: Swords, tone: 'tier-3', value: t('streaks.koValue', { n: streaks.current_ko_streak }), label: t('streaks.ko') });
  }
  if (streaks.current_flawless_streak > 0) {
    items.push({
      key: 'flawless',
      Icon: Shield,
      tone: 'tier-4',
      value: t('streaks.flawlessValue', { n: streaks.current_flawless_streak }),
      label: t('streaks.flawless'),
    });
  }

  if (items.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-2.5">
      {items.map(({ key, Icon, tone, value, label }) => (
        <li key={key} title={label} className="flex">
          <SkewChip tone={tone} className="px-2.5 py-1">
            <span className="inline-flex items-center gap-1.5">
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only">{label}: </span>
              {value}
            </span>
          </SkewChip>
        </li>
      ))}
    </ul>
  );
}
