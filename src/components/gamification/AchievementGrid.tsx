'use client';

import AchievementBadge, { HiddenAchievement, LockedAchievement } from '@/components/gamification/AchievementBadge';
import type {
  AchievementCategory,
  AchievementDefinition,
  EarnedAchievement,
} from '@/types/achievement';
import { useFormatter, useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';
import { achievementProgress, type AchievementProgressSource } from './achievement-progress';

interface AchievementGridProps {
  achievements: EarnedAchievement[];
  allDefinitions?: AchievementDefinition[];
  /** The profile's own counts, for the progress line of locked achievements. */
  progress?: AchievementProgressSource;
}

const CATEGORY_ORDER: AchievementCategory[] = ['combat', 'milestone', 'social', 'rare', 'meta'];

/** The badge case: every achievement by category, earned ones on their tier plate, locked ones quiet with their progress. */
export default function AchievementGrid({ achievements, allDefinitions, progress }: AchievementGridProps) {
  const t = useT(gamificationMessages);
  const formatter = useFormatter();
  const earnedByKey = new Map(achievements.map((achievement) => [achievement.key, achievement]));
  const definitions = allDefinitions ?? achievements;

  if (definitions.length === 0) {
    return <p className="text-body text-fg-muted">{t('achievements.empty')}</p>;
  }

  const earnedCount = definitions.filter((definition) => earnedByKey.has(definition.key)).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <p className="shrink-0 text-body text-fg">
          {t('achievements.earnedCount', { earned: formatter.number(earnedCount), total: formatter.number(definitions.length) })}
        </p>
        <div aria-hidden="true" className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-accent-ink" style={{ width: `${(earnedCount / definitions.length) * 100}%` }} />
        </div>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const items = definitions.filter((definition) => definition.category === category);
        if (items.length === 0) return null;

        return (
          <section key={category}>
            <h3 className="mb-2.5 text-subtitle font-[550] text-fg">{t(`achievements.categoryNames.${category}`)}</h3>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-2.5 px-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((definition) => {
                const earned = earnedByKey.get(definition.key);
                return (
                  <li key={definition.key}>
                    {earned ? (
                      <AchievementBadge achievement={earned} />
                    ) : definition.hidden ? (
                      <HiddenAchievement />
                    ) : (
                      <LockedAchievement definition={definition} progress={achievementProgress(definition, progress)} />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
