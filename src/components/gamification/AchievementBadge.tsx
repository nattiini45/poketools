'use client';

import { Lock } from 'lucide-react';
import type { AchievementDefinition, EarnedAchievement } from '@/types/achievement';
import { useFormatter, useLocale, useT } from '@/i18n/client';
import { achievementText } from '@/i18n/content/achievements';
import { gamificationMessages } from '@/i18n/messages/gamification';
import { cn } from '@/lib/utils/cn';
import { AchievementIcon } from './achievement-icons';

interface AchievementBadgeProps {
  achievement: EarnedAchievement;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_STYLES: Record<NonNullable<AchievementBadgeProps['size']>, string> = {
  sm: 'px-3 py-2',
  md: 'px-4 py-3',
  lg: 'px-5 py-4',
};

/** Achievement tiers on the four tier plates: bronze is the peach plate, silver the blue, gold the gold, platinum the green. */
const TIER_PLATE: Record<string, { soft: string; solid: string }> = {
  bronze: { soft: 'bg-tier-2-soft', solid: 'bg-tier-2' },
  silver: { soft: 'bg-tier-3-soft', solid: 'bg-tier-3' },
  gold: { soft: 'bg-tier-1-soft', solid: 'bg-tier-1' },
  platinum: { soft: 'bg-tier-4-soft', solid: 'bg-tier-4' },
};
const FALLBACK_PLATE = TIER_PLATE.platinum;

/** An earned achievement: a tier-coloured plate with its Lucide icon, name, description, tier and earned date. */
export default function AchievementBadge({ achievement, size = 'md' }: AchievementBadgeProps) {
  const t = useT(gamificationMessages);
  const locale = useLocale();
  const formatter = useFormatter();
  const text = achievementText(achievement, locale);
  const earnedDate = formatter.instant(achievement.earned_at, 'date');
  const plate = TIER_PLATE[achievement.tier] ?? FALLBACK_PLATE;
  const tooltip = t('achievements.earnedTooltip', { description: text.description, date: earnedDate });
  const tier = t.dynamic(`achievements.tierNames.${achievement.tier}`, undefined, achievement.tier);

  return (
    <div title={tooltip} className={cn('skew-plate h-full w-full grid-cols-[auto_minmax(0,1fr)] place-items-start gap-x-3 text-tier-ink', SIZE_STYLES[size])}>
      <span aria-hidden="true" className={cn('skew-plate-bg', plate.soft)} />
      <span className="skew-plate h-10 w-10">
        <span aria-hidden="true" className={cn('skew-plate-bg', plate.solid)} />
        <AchievementIcon definition={achievement} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-body font-[550]">{text.name}</div>
        <p className="line-clamp-2 text-caption">{text.description}</p>
        <p className="mt-1 text-micro">
          {achievement.times_earned > 1 ? t('achievements.timesEarned', { tier, count: achievement.times_earned }) : tier}
          {' · '}
          {t('achievements.earnedOn', { date: earnedDate })}
        </p>
      </div>
    </div>
  );
}

interface LockedAchievementProps {
  definition: AchievementDefinition;
  progress: { current: number; target: number } | null;
}

/** A locked achievement: the same plate, quiet. It still names what to do, and shows the count where the profile has it. */
export function LockedAchievement({ definition, progress }: LockedAchievementProps) {
  const t = useT(gamificationMessages);
  const locale = useLocale();
  const formatter = useFormatter();
  const text = achievementText(definition, locale);

  return (
    <div title={text.description} className="skew-plate h-full w-full grid-cols-[auto_minmax(0,1fr)] place-items-start gap-x-3 px-4 py-3">
      <span aria-hidden="true" className="skew-plate-bg border border-hairline bg-elevated" />
      <span className="skew-plate h-10 w-10 text-fg-muted">
        <span aria-hidden="true" className="skew-plate-bg bg-sunken" />
        <AchievementIcon definition={definition} className="h-5 w-5" />
      </span>
      <div className="min-w-0 justify-self-stretch">
        <div className="truncate text-body font-[550] text-fg">{text.name}</div>
        <p className="line-clamp-2 text-caption text-fg-muted">{text.description}</p>
        <p className="mt-1 text-micro text-fg-muted">
          {t.dynamic(`achievements.tierNames.${definition.tier}`, undefined, definition.tier)}
          {' · '}
          {t('achievements.locked')}
        </p>
        {progress && (
          <div className="mt-1.5 flex items-center gap-2">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.target}
              aria-valuenow={progress.current}
              aria-label={t('achievements.progressAria', {
                current: formatter.number(progress.current),
                target: formatter.number(progress.target),
              })}
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken"
            >
              <div className="h-full rounded-full bg-accent-ink" style={{ width: `${(progress.current / progress.target) * 100}%` }} />
            </div>
            <span aria-hidden="true" className="shrink-0 font-mono text-micro text-fg-muted tabular-nums">
              {t('achievements.progress', { current: formatter.number(progress.current), target: formatter.number(progress.target) })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** A hidden achievement nobody has revealed yet. */
export function HiddenAchievement() {
  const t = useT(gamificationMessages);
  return (
    <div title={t('achievements.hidden')} className="skew-plate h-full w-full grid-cols-[auto_minmax(0,1fr)] place-items-start gap-x-3 px-4 py-3">
      <span aria-hidden="true" className="skew-plate-bg border border-dashed border-hairline-strong" />
      <span className="skew-plate h-10 w-10 text-fg-muted">
        <span aria-hidden="true" className="skew-plate-bg bg-sunken" />
        <Lock aria-hidden="true" className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-body font-[550] text-fg">???</div>
        <p className="text-caption text-fg-muted">{t('achievements.hidden')}</p>
      </div>
    </div>
  );
}
