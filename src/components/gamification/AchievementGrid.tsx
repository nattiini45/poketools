'use client';

import AchievementBadge from '@/components/gamification/AchievementBadge';
import type {
  AchievementCategory,
  AchievementDefinition,
  EarnedAchievement,
} from '@/types/achievement';
import { useLocale, useT } from '@/i18n/client';
import { achievementText } from '@/i18n/content/achievements';
import { gamificationMessages } from '@/i18n/messages/gamification';

interface AchievementGridProps {
  achievements: EarnedAchievement[];
  allDefinitions?: AchievementDefinition[];
}

const CATEGORY_ORDER: AchievementCategory[] = ['combat', 'milestone', 'social', 'rare', 'meta'];

export default function AchievementGrid({
  achievements,
  allDefinitions,
}: AchievementGridProps) {
  const t = useT(gamificationMessages);
  const locale = useLocale();
  const earnedByKey = new Map(achievements.map((achievement) => [achievement.key, achievement]));
  const definitions = allDefinitions ?? achievements;

  if (definitions.length === 0) {
    return (
      <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-4 text-sm text-poke-text-tertiary">
        {t('achievements.empty')}
      </div>
    );
  }

  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-4">
      <h3 className="text-base font-heading font-bold text-poke-text-primary mb-4">{t('achievements.title')}</h3>

      <div className="space-y-5">
        {CATEGORY_ORDER.map((category) => {
          const items = definitions.filter((definition) => definition.category === category);
          if (items.length === 0) return null;

          return (
            <section key={category}>
              <h4 className="text-xs uppercase tracking-wide text-poke-text-tertiary mb-2">
                {t(`achievements.categories.${category}`)}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {items.map((definition) => {
                  const earned = earnedByKey.get(definition.key);
                  const isHiddenLocked = definition.hidden && !earned;

                  if (earned) {
                    return <AchievementBadge key={definition.key} achievement={earned} />;
                  }

                  if (isHiddenLocked) {
                    return (
                      <div
                        key={definition.key}
                        className="rounded-poke-lg border border-dashed border-poke-border bg-poke-elevated/40 p-3"
                        title={t('achievements.hidden')}
                      >
                        <div className="font-heading font-semibold text-poke-text-secondary">???</div>
                        <div className="text-xs text-poke-text-tertiary mt-1">{t('achievements.hidden')}</div>
                      </div>
                    );
                  }

                  const text = achievementText(definition, locale);
                  return (
                    <div
                      key={definition.key}
                      className="rounded-poke-lg border border-poke-border bg-poke-elevated/40 p-3 opacity-70"
                      title={text.description}
                    >
                      <div className="font-heading font-semibold text-poke-text-secondary truncate">
                        {text.name}
                      </div>
                      <div className="text-xs text-poke-text-tertiary mt-1 uppercase tracking-wide">
                        {t.dynamic(`achievements.tiers.${definition.tier}`, undefined, definition.tier)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
