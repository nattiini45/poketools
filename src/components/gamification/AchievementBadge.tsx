'use client';

import type { EarnedAchievement } from '@/types/achievement';
import { useFormatter, useLocale, useT } from '@/i18n/client';
import { achievementText } from '@/i18n/content/achievements';
import { gamificationMessages } from '@/i18n/messages/gamification';

interface AchievementBadgeProps {
  achievement: EarnedAchievement;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_STYLES: Record<NonNullable<AchievementBadgeProps['size']>, string> = {
  sm: 'p-2 text-xs',
  md: 'p-3 text-sm',
  lg: 'p-4 text-base',
};

const TIER_STYLES: Record<EarnedAchievement['tier'], string> = {
  bronze: 'border-amber-700/40 bg-amber-50',
  silver: 'border-slate-400 bg-slate-50',
  gold: 'border-yellow-500/60 bg-yellow-50',
  platinum: 'border-cyan-400/60 bg-gradient-to-br from-slate-50 via-cyan-50 to-sky-50',
};

export default function AchievementBadge({ achievement, size = 'md' }: AchievementBadgeProps) {
  const t = useT(gamificationMessages);
  const locale = useLocale();
  const formatter = useFormatter();
  const text = achievementText(achievement, locale);
  const earnedDate = formatter.instant(achievement.earned_at, 'date');
  const icon = achievement.icon?.trim() ? achievement.icon : '🏆';
  const tooltip = t('achievements.earnedTooltip', { description: text.description, date: earnedDate });
  const tier = t.dynamic(`achievements.tiers.${achievement.tier}`, undefined, achievement.tier);

  return (
    <div
      title={tooltip}
      className={`rounded-poke-lg border ${TIER_STYLES[achievement.tier]} ${SIZE_STYLES[size]}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">{icon}</span>
        <div className="min-w-0">
          <div className="font-heading font-semibold text-poke-text-primary truncate">
            {text.name}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-poke-text-tertiary mt-1">
            {achievement.times_earned > 1
              ? t('achievements.timesEarned', { tier, count: achievement.times_earned })
              : tier}
          </div>
        </div>
      </div>
    </div>
  );
}
