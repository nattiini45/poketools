/**
 * The isle themes' diegetic vocabulary for the shared league sections (C1),
 * in the viewer's language (T21). Each theme's `sections/copy.ts` binds its
 * plaque painter; the words live in `world-themes.sections.<themeId>`.
 */
import type { Locale } from '@/i18n/config';
import type { RulesCopyFn, ThemeSectionCopy } from '@/components/world/sections/types';
import { themeT } from './paint-copy';

/** The three themes that render the shared section kit. */
export type IsleThemeId = 'sakura' | 'mountain' | 'clouds';

export function isleSectionCopy(theme: IsleThemeId, locale: Locale, rulesCopy: RulesCopyFn): ThemeSectionCopy {
  const t = themeT(locale);
  return {
    place: t(`sections.${theme}.place`),
    scheduleUpcomingPainted: t(`sections.${theme}.scheduleUpcomingPainted`),
    teamsIntro: t(`sections.${theme}.teamsIntro`),
    rosterPointBuy: (count) => t(`sections.${theme}.rosterPointBuy`, { count }),
    rosterEmpty: t(`sections.${theme}.rosterEmpty`),
    rulesPlaysBy: t(`sections.${theme}.rulesPlaysBy`),
    rulesSpiritHeading: t(`sections.${theme}.rulesSpiritHeading`),
    rulesPlaqueNote: t(`sections.${theme}.rulesPlaqueNote`),
    rulesFormatNote: t(`sections.${theme}.rulesFormatNote`),
    rulesCopy,
  };
}
